export const ImportExportPage = () => (
  <section className="grid gap-6 lg:grid-cols-2">
    <article className="rounded-3xl bg-white p-6 shadow-panel">
      <h2 className="text-2xl font-semibold text-scs-blueDark">Importar y exportar</h2>
      <p className="mt-2 text-sm text-slate-600">
        Base preparada para importar CSV/JSON, mostrar vista previa y reemplazar el dataset con backup previo.
      </p>
    </article>
    <article className="rounded-3xl bg-white p-6 shadow-panel">
      <h3 className="text-xl font-semibold text-scs-blueDark">Backups</h3>
      <p className="mt-2 text-sm text-slate-600">
        El proceso de backup ya está disponible en Electron como utilidad base. La interfaz se completará en la siguiente iteración.
      </p>
    </article>
  </section>
);
