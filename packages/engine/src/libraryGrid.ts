const MIN_CARD_WIDTH = 175;
const GAP = 12;
const SIDE_PADDING = 12;

export interface GridLayout {
  columns: number;
  cardWidth: number;
  gap: number;
  sidePadding: number;
}

export function computeGridLayout(screenWidth: number): GridLayout {
  const availableWidth = screenWidth - SIDE_PADDING * 2;
  const columns = Math.max(1, Math.floor((availableWidth + GAP) / (MIN_CARD_WIDTH + GAP)));
  const cardWidth = (availableWidth - GAP * (columns - 1)) / columns;
  return { columns, cardWidth, gap: GAP, sidePadding: SIDE_PADDING };
}
