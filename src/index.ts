import "dotenv/config";
import { startBot } from "./bot/client";
import { startCron } from "./scheduler/cron";
import { startWebServer } from "./web/server";
import { DISCORD_BOT_TOKEN } from "./config";

async function main() {
  if (!DISCORD_BOT_TOKEN) {
    console.error("DISCORD_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.");
    process.exit(1);
  }

  await startBot();
  startCron();
  startWebServer(Number(process.env.WEB_PORT ?? 3000));
  console.log("✅ TradersEyes 봇 시작 완료");
}

main().catch((err) => {
  console.error("시작 오류:", err);
  process.exit(1);
});
