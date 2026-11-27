export const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
export const pct = (n: number, d = 1) => n.toFixed(d) + '%';
/** 年の表示（等幅・小数1桁） */
export const yearParts = (y: number) => {
  const yi = Math.floor(y + 1e-6);
  return { int: yi, frac: Math.min(9, Math.floor((y - yi) * 10 + 1e-6)) };
};
export const halfLabel = (h: number | null) =>
  h == null || h === 0 ? '2070年までは半減しない（推計）' : h < 0 ? '対象外' : `${h.toFixed(1)}年（推計）`;
export const loLabel = (lo: number) =>
  lo === 0 ? '2070年までは推計1人以上' : lo < 0 ? '対象外' : `${lo}年（推計1人未満）`;
export const esc = (s: string) => s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!);
