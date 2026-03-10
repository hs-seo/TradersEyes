import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawnSync } from "child_process";
import { buildAnalysisPrompt } from "../src/lib/prompts";

// .env.local 로드
const envPath = path.join(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = value;
  }
}

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
const CODEX_BIN = "/opt/homebrew/bin/codex";

async function captureChart(): Promise<{ buffer: Buffer; tmpPath: string }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  const url =
    "https://s.tradingview.com/widgetembed/?symbol=BINANCE:BTCUSDT&interval=15&theme=dark&style=1&locale=en&hide_top_toolbar=0&save_image=0";

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("canvas", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const buffer = await page.screenshot({ type: "png", fullPage: false });
  await browser.close();

  // 임시 파일로 저장 (codex exec -i 에 전달)
  const tmpPath = path.join(os.tmpdir(), `tradereyes-chart-${Date.now()}.png`);
  fs.writeFileSync(tmpPath, buffer);

  return { buffer, tmpPath };
}

function analyzeChart(imagePath: string): string {
  const prompt = `BTCUSDT 15분봉 차트를 보고 아래 항목만 간단히 한국어로 답해줘. 불필요한 설명 없이 핵심만.

1. **현재 파동**: 지금 몇 파동인지 (예: 5파 상승 중, ABC 조정 B파 등)
2. **직전 파동 완료 여부**: 직전 파동이 끝났는지, 아직 진행 중인지
3. **다음 예상 움직임**: 다음 파동 방향과 예상 타겟 레벨
4. **핵심 무효화 레벨**: 이 카운팅이 틀렸다고 볼 가격

5. **트레이딩 셋업**: 롱/숏 방향, 진입가, TP1/TP2, SL 레벨과 각각의 % (예: TP1 +1.2%, SL -0.8%)

6줄 이내로 답해줘.`;

  // 프롬프트가 길어 stdin으로 전달
  const result = spawnSync(
    CODEX_BIN,
    ["exec", "-i", imagePath],
    { input: prompt, encoding: "utf-8", timeout: 120_000 }
  );
  if (result.status !== 0) {
    throw new Error(`Codex 실패: ${result.stderr}`);
  }
  const raw = result.stdout;

  // codex exec 출력 파싱: "codex\n<답변>\ntokens used\n..." 에서 답변만 추출
  const lines = raw.split("\n");
  const codexIdx = lines.lastIndexOf("codex");
  const tokensIdx = lines.findIndex(
    (l, i) => i > codexIdx && l.startsWith("tokens used")
  );

  if (codexIdx !== -1) {
    const end = tokensIdx !== -1 ? tokensIdx : lines.length;
    return lines.slice(codexIdx + 1, end).join("\n").trim();
  }

  // 파싱 실패 시 전체 반환
  return raw.trim();
}

async function sendToDiscord(analysisText: string, imageBuffer: Buffer): Promise<void> {
  const now = new Date();
  const timestamp = now.toISOString();
  const kstTime = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  const MAX_EMBED_LENGTH = 4096;
  const chunks: string[] = [];
  let remaining = analysisText;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, MAX_EMBED_LENGTH));
    remaining = remaining.slice(MAX_EMBED_LENGTH);
  }

  const embeds = chunks.map((chunk, i) => ({
    title: i === 0 ? `📊 BTCUSDT 15m 자동 분석 (${kstTime} KST)` : `📊 분석 계속 (${i + 1}/${chunks.length})`,
    description: chunk,
    color: 0xf0a500,
    ...(i === 0 && { image: { url: "attachment://chart.png" } }),
    footer: i === chunks.length - 1 ? { text: "TradersEyes 자동 분석 | ICT SMC + Elliott Wave | Powered by Codex" } : undefined,
    timestamp: i === 0 ? timestamp : undefined,
  }));

  const formData = new FormData();
  formData.append("payload_json", JSON.stringify({ embeds, username: "TradersEyes Bot" }));
  formData.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), "chart.png");

  const res = await fetch(DISCORD_WEBHOOK_URL, { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord Webhook 실패 (${res.status}): ${text}`);
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] 자동 분석 시작`);

  if (!DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL이 설정되지 않았습니다.");
  }
  if (!fs.existsSync(CODEX_BIN)) {
    throw new Error(`Codex CLI를 찾을 수 없습니다: ${CODEX_BIN}`);
  }

  console.log("1/3 차트 캡처 중...");
  const { buffer, tmpPath } = await captureChart();

  try {
    console.log("2/3 Codex 분석 중...");
    const analysis = analyzeChart(tmpPath);

    console.log("3/3 Discord 전송 중...");
    await sendToDiscord(analysis, buffer);

    console.log(`[${new Date().toISOString()}] 완료`);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] 오류:`, err);
  process.exit(1);
});
