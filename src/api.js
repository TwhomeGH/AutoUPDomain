const endpoint = 'https://api005.dnshe.com/index.php?m=domain_hub&endpoint=subdomains&action=';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 查詢可有限重試；續期是有副作用的 POST，交給核心重新查詢確認結果。 */
export function createApi(fetcher = fetch, sleep = delay) {
  async function request(action, config, body) {
    let response;
    try {
      response = await fetcher(endpoint + action, {
        method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
        headers: {
          'X-API-Key': config.apiKey,
          'X-API-Secret': config.apiSecret,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('API 連線失敗或逾時');
    }
    if (!response.ok) {
      const error = new Error(`API HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('API 回傳格式錯誤');
    }
    if (!data || data.success === false || data.status === 'error' || data.error)
      throw new Error('API 拒絕操作，請確認憑證與網域狀態');
    return data;
  }
  return {
    async list(config, log = () => {}) {
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          data = await request('list', config);
          break;
        } catch (error) {
          if (attempt === 2 || (error.status && error.status < 500 && error.status !== 429))
            throw error;
          log(
            'warning',
            `查詢失敗（${error.message}），${2 ** attempt} 秒後第 ${attempt + 2} 次嘗試`,
          );
          await sleep(1000 * 2 ** attempt);
        }
      }
      if (!Array.isArray(data.subdomains)) throw new Error('API 未回傳 subdomains 清單');
      for (const domain of data.subdomains)
        if (
          !domain ||
          domain.id == null ||
          typeof domain.full_domain !== 'string' ||
          !Number.isFinite(Date.parse(domain.expires_at))
        )
          throw new Error('API 網域資料格式錯誤');
      return data.subdomains;
    },
    renew(id, config) {
      return request('renew', config, { subdomain_id: id });
    },
  };
}
/** 管道各自執行與回報失敗，Bark 故障不應阻止系統通知。 */
export function createNotifier(nativeNotify, fetcher = fetch) {
  return async (title, body, config) => {
    const channels = [];
    if (config.nativeNotifications) channels.push(['系統通知', () => nativeNotify(title, body)]);
    if (config.barkEnabled)
      channels.push([
        'Bark',
        async () => {
          const response = await fetcher(config.barkUrl, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body }),
          });
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (data.code !== 200) throw new Error();
        },
      ]);
    const results = await Promise.allSettled(
      channels.map(([, send]) => Promise.resolve().then(send)),
    );
    return results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${channels[index][0]}傳送失敗，請檢查系統權限或通知設定`]
        : [],
    );
  };
}
