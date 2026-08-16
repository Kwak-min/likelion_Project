import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const evidenceDir = new URL('./evidence/', import.meta.url);
await mkdir(evidenceDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  userDataDir: 'C:/Users/A/AppData/Local/Temp/regarde-browser-qa',
  args: ['--no-first-run', '--window-size=1440,1000']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle0' });

  await page.type('#i-email', 'a@naver.com');
  await page.type('#i-pw', 'aaaaaaaa');
  await Promise.all([
    page.click('#authBtn'),
    page.waitForFunction(() => document.querySelector('#s-home')?.classList.contains('on'))
  ]);

  await page.evaluate(() => Consult.start('repair'));
  await page.type('#chatInput', '구찌 재키 1961 잠금장치가 헐거워요');
  await page.click('.composer .send');
  await page.waitForFunction(
    () => [...document.querySelectorAll('#chatLog .msg.ai')].some(
      node => /구찌|재키|잠금장치/.test(node.textContent || '')
    ) && document.querySelectorAll('#chatLog .msg.ai').length >= 2,
    { timeout: 60_000 }
  );

  const answer = await page.$eval(
    '#chatLog .msg.ai:last-of-type',
    node => node.textContent?.trim() || ''
  );
  const screenshot = new URL('./browser-green.png', evidenceDir);
  await page.screenshot({ path: fileURLToPath(screenshot), fullPage: true });
  const log = {
    url: page.url(),
    login: 'a@naver.com',
    message: '구찌 재키 1961 잠금장치가 헐거워요',
    answer,
    screenshot: screenshot.pathname,
    captured_at: new Date().toISOString()
  };
  await writeFile(new URL('./browser-green.json', evidenceDir), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log));
} finally {
  await browser.close();
}
