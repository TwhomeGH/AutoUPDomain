import { EventEmitter } from 'node:events';

// 排程內部一律使用小時；intervalUnit 只保留使用者的顯示偏好。
export const defaults = {
  intervalHours: 24,
  intervalUnit: 'days',
  renewBeforeDays: 170,
  paused: false,
  notificationMode: 'important',
  nativeNotifications: true,
  barkEnabled: false,
  launchAtLogin: false,
  apiKey: '',
  apiSecret: '',
  barkUrl: '',
};
export function validateConfig(input) {
  const config = { ...defaults, ...input };
  // 舊設定沒有單位欄位，依原本小時數推算，保留實際執行間隔。
  config.intervalUnit = input?.intervalUnit ?? (config.intervalHours % 24 === 0 ? 'days' : 'hours');
  if (!['important', 'all', 'errors-only'].includes(config.notificationMode))
    throw new Error('通知時機無效');
  if (!['days', 'hours'].includes(config.intervalUnit)) throw new Error('檢查間隔單位無效');
  if (config.intervalUnit === 'days' && config.intervalHours % 24 !== 0)
    throw new Error('按天檢查請輸入整數天數');
  if (
    !Number.isFinite(config.intervalHours) ||
    config.intervalHours < 1 ||
    config.intervalHours > 2160
  )
    throw new Error('檢查間隔必須介於 1 至 2160 小時');
  if (
    !Number.isInteger(config.renewBeforeDays) ||
    config.renewBeforeDays < 1 ||
    config.renewBeforeDays > 180
  )
    throw new Error('續期門檻必須介於 1 至 180 天');
  for (const key of ['paused', 'nativeNotifications', 'barkEnabled', 'launchAtLogin'])
    if (typeof config[key] !== 'boolean') throw new Error('設定格式錯誤');
  for (const key of ['apiKey', 'apiSecret', 'barkUrl'])
    if (typeof config[key] !== 'string' || config[key].length > 4096)
      throw new Error('憑證格式錯誤');
  if (config.barkEnabled) {
    try {
      if (new URL(config.barkUrl).protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('Bark 請填入 HTTPS 網址');
    }
  }
  return config;
}
export function remainingDays(value, now = Date.now()) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) throw new Error('API 回傳無效到期時間');
  return Math.floor((date - now) / 86400000);
}

/**
 * 網域檢查協調器：托盤、Web UI 與 CLI 共用同一個流程。
 * API、通知、儲存與時鐘由外部注入，測試不需要連接真實網域。
 * change 事件更新托盤狀態；log 事件即時輸出已遮蔽的執行紀錄。
 */
export class DomainService extends EventEmitter {
  constructor({
    config,
    state = {},
    saveState = async () => {},
    api,
    notify = async () => [],
    now = Date.now,
  }) {
    super();
    this.config = validateConfig(config);
    this.state = {
      domains: [],
      history: [],
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      ...state,
    };
    this.saveState = saveState;
    this.api = api;
    this.notify = notify;
    this.now = now;
    this.running = false;
  }
  /** 面板只取得憑證是否存在，永遠不取得實際密鑰。 */
  snapshot() {
    const { apiKey, apiSecret, barkUrl, ...settings } = this.config;
    return {
      ...this.state,
      running: this.running,
      settings,
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret,
      hasBarkUrl: !!barkUrl,
    };
  }
  async persist() {
    await this.saveState(this.state);
    this.emit('change');
  }
  /** 先替換完整密鑰，再移除控制字元，避免日誌洩漏及偽造換行。 */
  redact(message) {
    let text = String(message);
    const secrets = [this.config.apiKey, this.config.apiSecret, this.config.barkUrl]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text.replace(/[\r\n\u001b]/g, ' ').slice(0, 4000);
  }
  log(level, message) {
    message = this.redact(message);
    this.state.history.unshift({ time: new Date(this.now()).toISOString(), level, message });
    this.state.history = this.state.history.slice(0, 200);
    this.emit('log', this.state.history[0]);
  }
  /** 通知失敗只寫入日誌，不將已成功的網域操作誤判為失敗。 */
  async publish(title, body, { isError = false } = {}) {
    if (this.config.notificationMode === 'errors-only' && !isError) {
      this.log('info', '通知時機設為僅錯誤，略過成功通知');
      return;
    }
    if (!this.config.nativeNotifications && !this.config.barkEnabled) {
      this.log('info', '通知管道皆已關閉，略過通知');
      return;
    }
    try {
      this.log('info', '開始傳送通知：' + title);
      const failures = await this.notify(this.redact(title), this.redact(body), this.config);
      if (!failures?.length)
        this.log(
          'info',
          this.config.nativeNotifications || this.config.barkEnabled
            ? '通知管道處理完成'
            : '通知管道皆已關閉',
        );
      for (const failure of failures || []) this.log('warning', failure);
    } catch {
      this.log('warning', '通知傳送失敗，請檢查通知設定');
    }
  }
  /** 定期比對持久化時間，讓重啟或睡眠恢復後能補跑一次。 */
  async tick() {
    if (
      this.config.paused ||
      this.running ||
      this.configuring ||
      !this.config.apiKey ||
      !this.config.apiSecret
    )
      return;
    if (!this.state.nextRunAt || Date.parse(this.state.nextRunAt) <= this.now())
      await this.run('scheduled');
  }
  /**
   * 同一輪共用 pending promise，避免重複續期。
   * 手動操作若加入執行中的排程，只要求該輪結束後補一則摘要。
   */
  run(source = 'manual') {
    if (this.configuring) {
      return Promise.reject(new Error('正在儲存設定，請稍後再試'));
    }
    if (this.pending) {
      if (source === 'manual') this.manualNotificationRequested = true;
      return this.pending;
    }

    this.manualNotificationRequested = source === 'manual';
    this.running = true;
    this.emit('change');
    this.pending = this.execute(source).finally(() => {
      this.running = false;
      this.pending = null;
      this.manualNotificationRequested = false;
      this.emit('change');
    });
    return this.pending;
  }

  async queryDomains(config) {
    this.log('info', '正在查詢網域清單');
    const domains = await this.api.list(config, (level, message) => this.log(level, message));
    this.log('info', '查詢完成，共 ' + domains.length + ' 個網域');
    return domains.map((domain) => ({
      id: domain.id,
      full_domain: domain.full_domain,
      expires_at: domain.expires_at,
      remainingDays: remainingDays(domain.expires_at, this.now()),
      status: '正常',
    }));
  }

  /** 遠端可能已完成續期但回應逾時；不重送 POST，改查到期日是否延長。 */
  async renewAndConfirm(domain, config) {
    let renewalError;
    try {
      await this.api.renew(domain.id, config);
    } catch (error) {
      renewalError = error;
      this.log('warning', '續期請求未確認，重新查詢以確認是否已生效');
    }

    this.log('info', '正在查詢續期後的到期時間');
    const refreshed = await this.api.list(config, (level, message) => this.log(level, message));
    const updated = refreshed.find((item) => String(item.id) === String(domain.id));
    const extended = updated && Date.parse(updated.expires_at) > Date.parse(domain.expires_at);
    if (!extended) {
      throw renewalError || new Error('續期後到期時間未延長，請確認供應商回應');
    }
    domain.expires_at = updated.expires_at;
    domain.remainingDays = remainingDays(updated.expires_at, this.now());
    domain.status = '已續期';
  }

  /** 單一網域失敗不影響其他網域，回傳結果供該輪摘要統計。 */
  async checkDomain(domain, config) {
    this.log('info', domain.full_domain + ' 剩餘 ' + domain.remainingDays + ' 天');
    if (domain.remainingDays >= config.renewBeforeDays) {
      this.log('info', domain.full_domain + ' 尚未達續期門檻，略過');
      return 'skipped';
    }

    try {
      this.log('info', domain.full_domain + ' 進入續期區間，正在送出續期請求');
      await this.renewAndConfirm(domain, config);
      this.log('success', domain.full_domain + ' 已續期至 ' + domain.expires_at);
      if (!this.usesSummary()) {
        await this.publish('網域已續期', domain.full_domain + ' 新到期時間：' + domain.expires_at);
      }
      return 'renewed';
    } catch (error) {
      domain.status = '續期未確認';
      this.log('error', domain.full_domain + '：' + error.message);
      if (!this.usesSummary()) {
        await this.publish(
          '網域續期需要處理',
          domain.full_domain + ' 續期未確認，請開啟面板查看紀錄。',
          { isError: true },
        );
      }
      return 'failed';
    }
  }

  // 所有結果模式每輪彙總一次，避免同時收到逐網域通知與摘要。
  usesSummary() {
    return this.manualNotificationRequested || this.config.notificationMode === 'all';
  }

  /** 摘要包含零網域與重複失敗；是否送出仍由通知時機與管道開關決定。 */
  async publishSummary(result) {
    const label = this.manualNotificationRequested ? '手動檢查' : '排程檢查';
    if (result.error) {
      await this.publish(label + '失敗', result.error + '。請開啟控制台查看詳情。', {
        isError: true,
      });
      return;
    }
    const title = label + (result.failed ? '完成，需處理' : '完成');
    const body =
      '共 ' +
      result.total +
      ' 個網域：續期成功 ' +
      result.renewed +
      '、無需續期 ' +
      result.skipped +
      '、待處理 ' +
      result.failed +
      '。';
    await this.publish(title, body, { isError: result.failed > 0 });
  }

  async execute(source) {
    // 每輪固定一份設定快照，避免執行中混用不同憑證或續期門檻。
    const config = { ...this.config };
    const result = { total: 0, renewed: 0, skipped: 0, failed: 0, error: null };
    this.state.lastRunAt = new Date(this.now()).toISOString();
    this.log('info', source === 'scheduled' ? '排程觸發，開始檢查' : '手動觸發，開始檢查');

    try {
      if (!config.apiKey || !config.apiSecret) throw new Error('請先設定 API Key 與 Secret');
      this.state.domains = await this.queryDomains(config);
      result.total = this.state.domains.length;
      for (const domain of this.state.domains) {
        const outcome = await this.checkDomain(domain, config);
        result[outcome]++;
      }

      if (result.failed) {
        this.state.lastError = '部分網域續期未確認，請查看紀錄';
      } else {
        const recovered = !!this.state.lastError;
        this.state.lastSuccessAt = new Date(this.now()).toISOString();
        this.state.lastError = null;
        this.log('info', '檢查完成，共 ' + result.total + ' 個網域');
        if (recovered && !this.usesSummary()) {
          await this.publish('網域檢查已恢復', '已成功完成網域檢查。');
        }
      }
    } catch (error) {
      result.error = this.redact(error.message);
      // 排程對相同連續錯誤去重；手動操作仍須在最後回覆該輪結果。
      if (!this.usesSummary() && this.state.lastError !== result.error) {
        await this.publish('網域檢查失敗', result.error, { isError: true });
      }
      this.state.lastError = result.error;
      this.log('error', result.error);
    } finally {
      const successful = !result.error && result.failed === 0;
      const waitHours = successful ? config.intervalHours : 1;
      this.state.nextRunAt = new Date(this.now() + waitHours * 3600000).toISOString();
      this.log(
        'info',
        '下次檢查時間：' + this.state.nextRunAt + (successful ? '' : '（失敗後 1 小時重試）'),
      );
      await this.persist();
    }

    // 放在第一次保存之後，也涵蓋保存期間才加入的手動操作。
    if (this.usesSummary()) {
      await this.publishSummary(result);
      await this.persist();
    }
    return this.snapshot();
  }
}
