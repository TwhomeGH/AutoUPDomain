import { EventEmitter } from 'node:events';

export const defaults = { intervalHours: 24, intervalUnit: 'days', renewBeforeDays: 170, paused: false, nativeNotifications: true, barkEnabled: false, launchAtLogin: false, apiKey: '', apiSecret: '', barkUrl: '' };
export function validateConfig(input) {
  const config = { ...defaults, ...input };
  config.intervalUnit = input?.intervalUnit ?? (config.intervalHours % 24 === 0 ? 'days' : 'hours');
  if (!['days', 'hours'].includes(config.intervalUnit)) throw new Error('檢查間隔單位無效');
  if (config.intervalUnit === 'days' && config.intervalHours % 24 !== 0) throw new Error('按天檢查請輸入整數天數');
  if (!Number.isFinite(config.intervalHours) || config.intervalHours < 1 || config.intervalHours > 2160) throw new Error('檢查間隔必須介於 1 至 2160 小時');
  if (!Number.isInteger(config.renewBeforeDays) || config.renewBeforeDays < 1 || config.renewBeforeDays > 180) throw new Error('續期門檻必須介於 1 至 180 天');
  for (const key of ['paused', 'nativeNotifications', 'barkEnabled', 'launchAtLogin']) if (typeof config[key] !== 'boolean') throw new Error('設定格式錯誤');
  for (const key of ['apiKey', 'apiSecret', 'barkUrl']) if (typeof config[key] !== 'string' || config[key].length > 4096) throw new Error('憑證格式錯誤');
  if (config.barkEnabled) {
    try { if (new URL(config.barkUrl).protocol !== 'https:') throw new Error(); } catch { throw new Error('Bark 請填入 HTTPS 網址'); }
  }
  return config;
}
export function remainingDays(value, now = Date.now()) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) throw new Error('API 回傳無效到期時間');
  return Math.floor((date - now) / 86400000);
}

export class DomainService extends EventEmitter {
  constructor({ config, state = {}, saveState = async () => {}, api, notify = async () => [], now = Date.now }) {
    super();
    this.config = validateConfig(config);
    this.state = { domains: [], history: [], nextRunAt: null, lastRunAt: null, lastSuccessAt: null, lastError: null, ...state };
    this.saveState = saveState; this.api = api; this.notify = notify; this.now = now; this.running = false;
  }
  snapshot() {
    const { apiKey, apiSecret, barkUrl, ...settings } = this.config;
    return { ...this.state, running: this.running, settings, hasApiKey: !!apiKey, hasApiSecret: !!apiSecret, hasBarkUrl: !!barkUrl };
  }
  async persist() { await this.saveState(this.state); this.emit('change'); }
  redact(message) {
    let text = String(message);
    const secrets = [this.config.apiKey, this.config.apiSecret, this.config.barkUrl].filter(Boolean).sort((a, b) => b.length - a.length);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text.replace(/[\r\n\u001b]/g, ' ').slice(0, 4000);
  }
  log(level, message) {
    message = this.redact(message);
    this.state.history.unshift({ time: new Date(this.now()).toISOString(), level, message });
    this.state.history = this.state.history.slice(0, 200);
    this.emit('log', this.state.history[0]);
  }
  async publish(title, body) {
    try {
      this.log('info', '開始傳送通知：' + title);
      const failures = await this.notify(title, body, this.config);
      if (!failures?.length) this.log('info', this.config.nativeNotifications || this.config.barkEnabled ? '通知管道處理完成' : '通知管道皆已關閉');
      for (const failure of failures || []) this.log('warning', failure);
    } catch { this.log('warning', '通知傳送失敗，請檢查通知設定'); }
  }
  async tick() {
    if (this.config.paused || this.running || this.configuring || !this.config.apiKey || !this.config.apiSecret) return;
    if (!this.state.nextRunAt || Date.parse(this.state.nextRunAt) <= this.now()) await this.run('scheduled');
  }
  run(source = 'manual') {
    if (this.configuring) return Promise.reject(new Error('正在儲存設定，請稍後再試'));
    if (this.pending) return this.pending;
    this.running = true; this.emit('change');
    this.pending = this.execute(source).finally(() => { this.running = false; this.pending = null; this.emit('change'); });
    return this.pending;
  }
  async execute(source) {
    const config = { ...this.config };
    this.state.lastRunAt = new Date(this.now()).toISOString();
    let successful = true;
    this.log('info', source === 'scheduled' ? '排程觸發，開始檢查' : '手動觸發，開始檢查');
    try {
      if (!config.apiKey || !config.apiSecret) throw new Error('請先設定 API Key 與 Secret');
      this.log('info', '正在查詢網域清單');
      const domains = await this.api.list(config, (level, message) => this.log(level, message));
      this.log('info', `查詢完成，共 ${domains.length} 個網域`);
      this.state.domains = domains.map(domain => ({ id: domain.id, full_domain: domain.full_domain, expires_at: domain.expires_at, remainingDays: remainingDays(domain.expires_at, this.now()), status: '正常' }));
      for (const domain of this.state.domains) {
        this.log('info', `${domain.full_domain} 剩餘 ${domain.remainingDays} 天`);
        if (domain.remainingDays >= config.renewBeforeDays) { this.log('info', `${domain.full_domain} 尚未達續期門檻，略過`); continue; }
        try {
          // Never retry a renewal blindly: a timeout may have applied remotely.
          this.log('info', `${domain.full_domain} 進入續期區間，正在送出續期請求`);
          let renewalError;
          try { await this.api.renew(domain.id, config); } catch (error) { renewalError = error; this.log('warning', '續期請求未確認，重新查詢以確認是否已生效'); }
          this.log('info', '正在查詢續期後的到期時間');
          const refreshed = await this.api.list(config, (level, message) => this.log(level, message));
          const updated = refreshed.find(item => String(item.id) === String(domain.id));
          if (!updated || !(Date.parse(updated.expires_at) > Date.parse(domain.expires_at))) throw renewalError || new Error('續期後到期時間未延長，請確認供應商回應');
          domain.expires_at = updated.expires_at;
          domain.remainingDays = remainingDays(updated.expires_at, this.now()); domain.status = '已續期';
          this.log('success', `${domain.full_domain} 已續期至 ${domain.expires_at}`);
          await this.publish('網域已續期', `${domain.full_domain} 新到期時間：${domain.expires_at}`);
        } catch (error) {
          successful = false; domain.status = '續期未確認';
          this.log('error', `${domain.full_domain}：${error.message}`);
          await this.publish('網域續期需要處理', `${domain.full_domain} 續期未確認，請開啟面板查看紀錄。`);
        }
      }
      if (successful) {
        const recovered = !!this.state.lastError;
        this.state.lastSuccessAt = new Date(this.now()).toISOString(); this.state.lastError = null;
        this.log('info', `檢查完成，共 ${domains.length} 個網域`);
        if (recovered) await this.publish('網域檢查已恢復', '已成功完成網域檢查。');
      } else this.state.lastError = '部分網域續期未確認，請查看紀錄';
    } catch (error) {
      successful = false;
      if (this.state.lastError !== this.redact(error.message)) await this.publish('網域檢查失敗', this.redact(error.message));
      this.state.lastError = this.redact(error.message); this.log('error', error.message);
    } finally {
      this.state.nextRunAt = new Date(this.now() + (successful ? config.intervalHours : 1) * 3600000).toISOString();
      this.log('info', `下次檢查時間：${this.state.nextRunAt}${successful ? '' : '（失敗後 1 小時重試）'}`);
      await this.persist();
    }
    return this.snapshot();
  }
}
