// Two kinds of money, as the brief puts it: "UPI works while the phone lives".
//   cash: notes in your pocket, always good;
//   upi:  money in the bank, spendable only while the phone has charge.
// App rides (cab, bike taxi) take UPI only. Everyone else takes either. When both work, UPI goes first,
// like it does in real life, which is exactly what makes a dying phone frightening.

export interface Wallet {
  cash: number;
  upi?: number;
  battery: number;
}

/** "any": cash or UPI. "upi": app payments only. */
export type PayBy = "any" | "upi";

export const phoneWorks = (w: Wallet) => w.battery > 0;
const upiOf = (w: Wallet) => w.upi ?? 0;

/** What you can actually spend right now, this way. */
export function spendable(w: Wallet, by: PayBy = "any"): number {
  const upi = phoneWorks(w) ? upiOf(w) : 0;
  return by === "upi" ? upi : w.cash + upi;
}

/** Everything you own, usable or not. */
export const totalMoney = (w: Wallet) => w.cash + upiOf(w);

/** Takes `amount`, UPI first while the phone works, then cash. Throws if it can't be paid: callers check first. */
export function payFrom(w: Wallet & { upi?: number }, amount: number, by: PayBy = "any"): { upi: number; cash: number } {
  if (amount > spendable(w, by)) throw new Error(`Invariant: tried to pay ₹${amount} with ₹${spendable(w, by)} (${by})`);
  const fromUpi = Math.min(amount, phoneWorks(w) ? upiOf(w) : 0);
  const fromCash = amount - fromUpi;
  w.upi = upiOf(w) - fromUpi;
  w.cash -= fromCash;
  return { upi: fromUpi, cash: fromCash };
}

/** "₹150 cash and ₹420 on UPI", or "₹150 cash (₹420 locked in UPI: the phone is dead)". */
export function describeWallet(w: Wallet): string {
  const upi = upiOf(w);
  if (!upi) return `₹${w.cash} cash`;
  return phoneWorks(w) ? `₹${w.cash} cash and ₹${upi} on UPI` : `₹${w.cash} cash (₹${upi} is stuck in UPI: your phone is dead)`;
}
