export interface DimSumDish {
  id: string;
  nameEn: string;
  nameZhHant: string;
  emoji: string;
}

/**
 * Metadata-only fallback. Consumer UI never downloads, generates, or vendors
 * catalog photography; the emoji is an honest local illustration substitute.
 */
export const LOCAL_DIM_SUM_METADATA: readonly DimSumDish[] = [
  { id: "har-gow", nameEn: "Classic Har Gow", nameZhHant: "蝦餃", emoji: "🥟" },
  { id: "siu-mai", nameEn: "Siu Mai", nameZhHant: "燒賣", emoji: "🥟" },
  { id: "char-siu-bao", nameEn: "Char Siu Bao", nameZhHant: "叉燒包", emoji: "🍞" },
  { id: "egg-tart", nameEn: "Egg Tart", nameZhHant: "蛋撻", emoji: "🥧" },
];

export function chooseDimSum(random = Math.random): DimSumDish {
  const index = Math.floor(random() * LOCAL_DIM_SUM_METADATA.length);
  return LOCAL_DIM_SUM_METADATA[Math.max(0, Math.min(LOCAL_DIM_SUM_METADATA.length - 1, index))];
}
