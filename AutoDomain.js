import axios from 'axios';
import dotenv from 'dotenv';
import dayjs from 'dayjs'

dotenv.config(); // 載入 .env


/**
 * 計算剩餘天數並格式化輸出
 * @param {Array} subdomains - API 回傳的 subdomains 陣列
 * @returns {Array} 格式化結果，例如 ["coffee3322.ccwu.cc 剩餘 3650 天 - 2036-04-29 08:25:42"]
 */
function formatSubdomainExpiry(subdomains) {
  const now = dayjs();

  return subdomains.map(sd => {
    const expiresAt = dayjs(sd.expires_at);
    const remainingDays = expiresAt.diff(now, 'day');

    let FormattedDate = expiresAt.format('YYYY-MM-DD A HH:mm:ss');

    return `${sd.full_domain} 剩餘 ${remainingDays} 天 - ${FormattedDate}`;
  });
}

const isBark = process.env.BARK_API && process.env.BARK_API.toLowerCase() !== "none";
const Bark = process.env.BARK_API;

async function sendBarkNotification(title = "Twitch", comment, icon) {

    if (!isBark) { return }
    if (!Bark || Bark.toLowerCase() === "none") return;
    try {

        await axios.post(Bark, { title, body: comment, icon }, { headers: { "Content-Type": "application/json" } });
        console.log("✅ Bark 推送成功");
    } catch (err) {
        console.error("❌ Bark 推送錯誤:", err.message);
    }
}

async function getSubdomains() {
    try {
        const response = await axios.get(
            'https://api005.dnshe.com//index.php?m=domain_hub&endpoint=subdomains&action=list',
            {
                headers: {
                    'X-API-Key': process.env.API_KEY,
                    'X-API-Secret': process.env.API_SECRET,
                },
            }
        );

        console.log('Response:', response.data);

        if (response.data && response.data.subdomains) {
            const formattedSubdomains = formatSubdomainExpiry(response.data.subdomains);
            
            var RES = []
            formattedSubdomains.forEach(info => {
                console.log(info)
                RES.push(info)
            });

            RES = RES.join("\n")
            sendBarkNotification("子網域到期時間提醒", RES, "https://www.dnshe.com/favicon.ico");


        } else {
            console.log('No subdomains found in the response.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}





/**
 * 專用函數：續期子網域
 * @param {number} subdomainId - 要續期的子網域 ID
 */
async function renewSubdomain(subdomainId) {
    try {
        const response = await axios.post(
            'https://api005.dnshe.com/index.php?m=domain_hub&endpoint=subdomains&action=renew',
            { subdomain_id: subdomainId },
            {
                headers: {
                    'X-API-Key': process.env.API_KEY,
                    'X-API-Secret': process.env.API_SECRET,
                    'Content-Type': 'application/json',
                },
            }
        );

        console.log('Renew Response:', response.data);
        return response.data;
    } catch (error) {
        console.error('Renew Error:', error.message);
        throw error;
    }
}





/**
 * 取得指定子網域詳情
 * @param {number} subdomainId - 子網域 ID
 */
async function getSubdomainInfo(subdomainId) {
  try {
    const response = await axios.get(
      `https://api005.dnshe.com/index.php?m=domain_hub&endpoint=subdomains&action=get&subdomain_id=${subdomainId}`,
      {
        headers: {
          'X-API-Key': process.env.API_KEY,
          'X-API-Secret': process.env.API_SECRET,
        },
      }
    );

    console.log('Subdomain Details:', response.data);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Get Error:', error.response.status, error.response.data);
    } else {
      console.error('Get Error:', error.message);
    }
    throw error;
  }
}






getSubdomains();


// 範例呼叫
// getSubdomainInfo(218576).then((data) => {
//     console.log('子網域詳情:', data);
// }).catch((error) => {
//     console.error('獲取子網域詳情失敗:', error.message);
// });





// 範例呼叫 快到期 180天才可以用
// renewSubdomain("218576").then((data) => {
//     console.log('續期成功:', data);
// }).catch((error) => {
//     console.error('續期失敗:', error.message);
// });
