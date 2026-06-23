import type { EditableSocialContact, SocialPlatform } from "../../../shared/types/contact";
import { SelectField } from "../inputs/SelectField";
import type { ContactFormState } from "../../hooks/useContactForm";
import { createSocialDraft, socialPlatformOptions } from "../../hooks/useContactForm";

type Props = {
  socials: ContactFormState["contactMethods"]["socials"];
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  setLiveMessage: React.Dispatch<React.SetStateAction<string>>;
  updateSocial: (socialId: string, patch: Partial<EditableSocialContact>) => void;
  removeSocial: (socialId: string) => void;
};

export const SocialsSection = ({
  socials,
  setFormState,
  setLiveMessage,
  updateSocial,
  removeSocial
}: Props) => (
  <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="text-lg font-semibold text-scs-blueDark">Redes sociales</h3>
      <button
        type="button"
        onClick={() => {
          const nextSocial = {
            ...createSocialDraft(),
            isPrimary: socials.length === 0
          };
          setFormState((current) => ({
            ...current,
            contactMethods: {
              ...current.contactMethods,
              socials: [...current.contactMethods.socials, nextSocial]
            }
          }));
          setLiveMessage(`Red social ${socials.length + 1} añadida.`);
        }}
        className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
      >
        Añadir red social
      </button>
    </div>

    <div className="space-y-4">
      {socials.map((social, index) => (
        <div key={social.id} className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-700">Red social {index + 1}</p>
            <button
              type="button"
              onClick={() => removeSocial(social.id)}
              className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
            >
              Eliminar
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div>
              <SelectField
                id={`social-platform-${social.id}`}
                label="Plataforma"
                value={social.platform}
                onChange={(value) => updateSocial(social.id, { platform: value as SocialPlatform })}
                options={socialPlatformOptions}
              />
            </div>
            <div>
              <label htmlFor={`social-handle-${social.id}`} className="text-sm font-medium text-slate-700">Handle / usuario</label>
              <input
                id={`social-handle-${social.id}`}
                value={social.handle ?? ""}
                onChange={(event) => updateSocial(social.id, { handle: event.target.value })}
                placeholder="@hospitalejemplo"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor={`social-url-${social.id}`} className="text-sm font-medium text-slate-700">URL</label>
              <input
                id={`social-url-${social.id}`}
                value={social.url ?? ""}
                onChange={(event) => updateSocial(social.id, { url: event.target.value })}
                placeholder="https://instagram.com/hospital"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <label htmlFor={`social-label-${social.id}`} className="text-sm font-medium text-slate-700">Etiqueta</label>
              <input
                id={`social-label-${social.id}`}
                value={social.label ?? ""}
                onChange={(event) => updateSocial(social.id, { label: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700 xl:mt-8">
              <input
                type="checkbox"
                checked={social.isPrimary}
                onChange={(event) => updateSocial(social.id, { isPrimary: event.target.checked })}
              />
              Principal
            </label>
          </div>
        </div>
      ))}
    </div>
  </section>
);
