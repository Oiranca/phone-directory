import { Link } from "react-router-dom";

export const NotFoundPage = () => (
  <section aria-labelledby="not-found-title" className="rounded-3xl bg-white p-6 shadow-panel">
    <h2 id="not-found-title" className="text-2xl font-semibold text-scs-blueDark">Pantalla no encontrada</h2>
    <p className="mt-2 text-sm text-slate-600">Esta dirección no existe en la aplicación. Puede que el enlace esté mal escrito o que la pantalla haya sido movida.</p>
    <Link
      to="/"
      className="focus-ring mt-4 inline-block rounded-full bg-scs-blue px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
    >
      Volver al inicio
    </Link>
  </section>
);
