import type { DirectoryHighlight } from "../../../shared/constants/directoryHighlights";

interface DirectoryHighlightCardProps {
  highlight: DirectoryHighlight;
}

const formatSpanishList = (values: readonly string[]): string => {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} y ${values[values.length - 1]}`;
};

export const DirectoryHighlightCard = ({ highlight }: DirectoryHighlightCardProps) => (
  <aside
    aria-label="Contacto destacado de citas"
    className="shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-scs-blueDark">{highlight.title}</h3>
        <p className="mt-1 text-sm text-slate-600">{highlight.scope}</p>
      </div>
      <span className="shrink-0 rounded-full bg-scs-mist px-2.5 py-1 text-[11px] font-semibold text-scs-blueDark">
        Contacto fijo
      </span>
    </div>

    <dl className="mt-4 grid grid-cols-2 gap-4">
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Teléfono</dt>
        <dd className="mt-1 text-2xl font-bold tabular-nums leading-none text-scs-blueDark">{highlight.phone}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Horario</dt>
        <dd className="mt-1 text-sm font-semibold leading-6 text-slate-700">
          <span aria-hidden="true">{highlight.schedule}</span>
          <span className="sr-only">De lunes a viernes, de 08:00 a 21:00</span>
        </dd>
      </div>
    </dl>

    <div className="mt-4 border-t border-slate-200 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">No gestiona</p>
      <p className="mt-1 text-xs leading-5 text-slate-700">{formatSpanishList(highlight.exclusions)}.</p>
    </div>
  </aside>
);
