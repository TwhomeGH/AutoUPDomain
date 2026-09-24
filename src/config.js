import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { validateConfig } from './core.js';

export async function loadConfig({ envFile, environment = process.env, settings = {}, credentials = {}, ignoreEnv = false }) {
  let file = {};
  if (!ignoreEnv) {
    try { file = parse(await readFile(envFile)); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('無法讀取專案 .env，請檢查檔案權限'); }
  }
  const env = ignoreEnv ? {} : { ...file, ...environment };
  const bark = (env.BARK_API || '').trim();
  const barkUrl = bark.toLowerCase() === 'none' ? '' : bark;
  return validateConfig({ apiKey: env.API_KEY || '', apiSecret: env.API_SECRET || '', barkUrl, barkEnabled: !!barkUrl, ...settings, ...credentials });
}
