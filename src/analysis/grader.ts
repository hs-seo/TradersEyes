import type { OrderBlock } from "../engine/types";
import type { StructureBreak } from "./choch";

export type OBGrade = "S" | "A" | "B";

export interface GradedOB {
  ob: OrderBlock;
  grade: OBGrade;
  score: number;
  reasons: string[];
  latestBreak?: StructureBreak;  // OB 도달 후 발생한 CHoCH/BOS
  isNear: boolean;               // 현재가가 OB 근접 여부
  distancePct: number;           // 현재가 ~ OB 거리 (%)
}

/**
 * S / A / B 등급 판별
 *
 * 점수제:
 *  +3  CHoCH 발생 (OB 도달 후 추세 전환 확인) — 최고 신뢰
 *  +2  BOS 발생 (OB 도달 후 추세 지속 확인)
 *  +3  4H + 1H confluence (같은 방향 zone 겹침)
 *  +2  OB status = touched (현재가 zone 진입 이력)
 *  +2  RSI 극한 (inRsiExtreme)
 *  +3  다이버전스 (hasDivergence)
 *  +1  4H timeframe (신뢰도 보정)
 *
 *  S급: 7점 이상 → 즉시 Discord 알림
 *  A급: 4~6점   → POI 대기 (/poi 조회)
 *  B급: 3점 이하 → 배경 감시
 */
export function gradeOBs(
  obs: OrderBlock[],
  currentPrice: number,
  breaks15m: StructureBreak[],
  breaks1h: StructureBreak[]
): GradedOB[] {
  return obs
    .filter((ob) => ob.status === "active" || ob.status === "touched")
    .map((ob) => {
      let score = 0;
      const reasons: string[] = [];

      // 현재가 ~ OB 거리
      const mid = (ob.zoneHigh + ob.zoneLow) / 2;
      const distancePct = Math.abs(currentPrice - mid) / mid * 100;
      const isNear = distancePct <= 2.0; // 2% 이내

      // OB 형성 이후 발생한 구조 이탈 (CHoCH/BOS)
      const relevantBreaks = [...breaks15m, ...breaks1h].filter(
        (b) => b.timestamp >= ob.createdAt && b.direction === ob.direction
      );
      const latestBreak = relevantBreaks.length > 0
        ? relevantBreaks[relevantBreaks.length - 1]
        : undefined;

      if (latestBreak?.type === "CHoCH") {
        score += 3;
        reasons.push("CHoCH 확인 ✅");
      } else if (latestBreak?.type === "BOS") {
        score += 2;
        reasons.push("BOS 확인");
      }

      // 4H + 1H confluence: 같은 방향 OB가 가격대 겹침
      const has1hConfluence = obs.some(
        (other) =>
          other.id !== ob.id &&
          other.timeframe === "1h" &&
          other.direction === ob.direction &&
          other.zoneLow <= ob.zoneHigh &&
          other.zoneHigh >= ob.zoneLow
      );
      if (has1hConfluence) {
        score += 3;
        reasons.push("MTF Confluence (4H+1H)");
      }

      // OB 터치됨
      if (ob.status === "touched") {
        score += 2;
        reasons.push("OB 터치됨");
      }

      // RSI 극한
      if (ob.inRsiExtreme) {
        score += 2;
        reasons.push(`RSI 극한 (${ob.rsiAtFormation.toFixed(1)})`);
      }

      // 다이버전스
      if (ob.hasDivergence) {
        score += 3;
        reasons.push("다이버전스");
      }

      // 4H 타임프레임 보정
      if (ob.timeframe === "4h") {
        score += 1;
      }

      // 근접하지 않으면 S급 불가 (진입 알림이 의미 없음)
      let grade: OBGrade;
      if (score >= 7 && isNear) {
        grade = "S";
      } else if (score >= 4) {
        grade = "A";
      } else {
        grade = "B";
      }

      return { ob, grade, score, reasons, latestBreak, isNear, distancePct };
    })
    .sort((a, b) => b.score - a.score);
}
