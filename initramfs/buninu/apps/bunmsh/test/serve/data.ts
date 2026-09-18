interface Item {
  name: string;
  count: number;
}

function total<T extends Item>(items: T[]): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

const items: Item[] = [
  { name: "ts", count: 1 },
  { name: "js", count: 2 },
];

export const grandTotal: number = total(items);
