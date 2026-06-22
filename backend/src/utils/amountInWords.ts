const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertBelow1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${ONES[h]} Hundred ${convertBelow1000(rest)}` : `${ONES[h]} Hundred`;
}

function convertInteger(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const scales = [
    { value: 1_000_000_000, label: 'Billion' },
    { value: 1_000_000, label: 'Million' },
    { value: 1_000, label: 'Thousand' },
  ];
  let remaining = n;
  for (const scale of scales) {
    if (remaining >= scale.value) {
      const count = Math.floor(remaining / scale.value);
      remaining %= scale.value;
      parts.push(`${convertBelow1000(count)} ${scale.label}`);
    }
  }
  if (remaining > 0) parts.push(convertBelow1000(remaining));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Philippine-style amount in words, e.g. "One Hundred Pesos and 50/100 Only". */
export function formatAmountInWords(
  amount: unknown,
  currencySingular = 'Peso',
  currencyPlural = 'Pesos',
): string {
  const n = Math.abs(parseFloat(String(amount ?? 0)) || 0);
  const pesos = Math.floor(n + 0.000001);
  const centavos = Math.min(99, Math.round((n - pesos) * 100));
  const words = convertInteger(pesos);
  const currencyWord = pesos === 1 ? currencySingular : currencyPlural;
  return `${words} ${currencyWord} and ${String(centavos).padStart(2, '0')}/100 Only`;
}
