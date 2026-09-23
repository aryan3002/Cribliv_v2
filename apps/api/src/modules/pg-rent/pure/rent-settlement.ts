/** Spec §6.11 statement math. All paise. */
export function settlementNet(i: {
  depositHeld: number;
  credit: number;
  openDues: number;
  deductions: number;
}): { net: number; toReturn: number } {
  const net = i.depositHeld + i.credit - i.openDues - i.deductions;
  return { net, toReturn: Math.max(0, net) };
}
