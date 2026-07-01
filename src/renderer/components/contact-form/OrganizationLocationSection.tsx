import type { AreaType } from "../../../shared/constants/catalogs";
import { SelectField } from "../inputs/SelectField";
import type { ContactFormState } from "../../hooks/useContactForm";
import { areaOptions } from "../../hooks/useContactForm";

type Props = {
  formState: ContactFormState;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  availableAreas: AreaType[];
};

export const OrganizationLocationSection = ({ formState, setFormState, availableAreas }: Props) => (
  <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
    <h3 className="text-lg font-semibold text-scs-blueDark">Organización y ubicación</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="department" className="text-sm font-medium text-slate-700">
          Departamento
        </label>
        <input
          id="department"
          value={formState.organization.department}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              organization: { ...current.organization, department: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>

      <div>
        <label htmlFor="service" className="text-sm font-medium text-slate-700">
          Servicio
        </label>
        <input
          id="service"
          value={formState.organization.service}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              organization: { ...current.organization, service: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <SelectField
          id="area"
          label="Área"
          value={formState.organization.area ?? ""}
          onChange={(value) =>
            setFormState((current) => ({
              ...current,
              organization: {
                ...current.organization,
                area: value ? (value as AreaType) : undefined
              }
            }))
          }
          options={[
            { value: "", label: "Sin área" },
            ...availableAreas.map((area) => ({
              value: area,
              label: areaOptions.find((option) => option.value === area)?.label ?? area
            }))
          ]}
        />
      </div>

      <div>
        <label htmlFor="specialty" className="text-sm font-medium text-slate-700">
          Especialidad
        </label>
        <input
          id="specialty"
          value={formState.organization.specialty}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              organization: { ...current.organization, specialty: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="building" className="text-sm font-medium text-slate-700">
          Edificio
        </label>
        <input
          id="building"
          value={formState.location.building}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              location: { ...current.location, building: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>

      <div>
        <label htmlFor="floor" className="text-sm font-medium text-slate-700">
          Planta
        </label>
        <input
          id="floor"
          value={formState.location.floor}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              location: { ...current.location, floor: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="room" className="text-sm font-medium text-slate-700">
          Sala / despacho
        </label>
        <input
          id="room"
          value={formState.location.room}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              location: { ...current.location, room: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>

      <div>
        <label htmlFor="locationText" className="text-sm font-medium text-slate-700">
          Texto libre de ubicación
        </label>
        <input
          id="locationText"
          value={formState.location.text}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              location: { ...current.location, text: event.target.value }
            }))
          }
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
      </div>
    </div>
  </section>
);
