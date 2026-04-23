node -e "
const fs = require('fs');
let content = fs.readFileSync('src/renderer/pages/ContactFormPage.tsx', 'utf8');

// displayName
content = content.replace(
  '<input\n                type=\"text\"\n                id=\"displayName\"\n                required\n                value={formState.displayName}\n                onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}\n                className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n              />',
  '<input\n                type=\"text\"\n                id=\"displayName\"\n                required\n                value={formState.displayName}\n                onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}\n                aria-invalid={!!fieldErrors.displayName}\n                aria-describedby={fieldErrors.displayName ? \\'err-displayName\\' : undefined}\n                className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n              />'
);
content = content.replace(
  '{fieldErrors.displayName && <p className=\"mt-2 text-sm text-red-600\">{fieldErrors.displayName}</p>}',
  '{fieldErrors.displayName && <p id=\"err-displayName\" role=\"alert\" className=\"mt-2 text-sm text-red-600\">{fieldErrors.displayName}</p>}'
);

// phone number
content = content.replace(
  '<input\n                      type=\"tel\"\n                      placeholder=\"Ej: 928 123 456\"\n                      value={phone.number}\n                      onChange={(event) => updatePhone(phone.id, { number: event.target.value })}\n                      className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n                    />',
  '<input\n                      type=\"tel\"\n                      placeholder=\"Ej: 928 123 456\"\n                      value={phone.number}\n                      onChange={(event) => updatePhone(phone.id, { number: event.target.value })}\n                      aria-invalid={!!fieldErrors[\\`contactMethods.phones.\\${index}.number\\`]}\n                      aria-describedby={fieldErrors[\\`contactMethods.phones.\\${index}.number\\`] ? \\`err-phone-\\${index}\\` : undefined}\n                      className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n                    />'
);
content = content.replace(
  '{fieldErrors[\\`contactMethods.phones.\\${index}.number\\`] && (\n                      <p className=\"mt-2 text-sm text-red-600\">{fieldErrors[\\`contactMethods.phones.\\${index}.number\\`]}</p>\n                    )}',
  '{fieldErrors[\\`contactMethods.phones.\\${index}.number\\`] && (\n                      <p id={\\`err-phone-\\${index}\\`} role=\"alert\" className=\"mt-2 text-sm text-red-600\">{fieldErrors[\\`contactMethods.phones.\\${index}.number\\`]}</p>\n                    )}'
);

// email address
content = content.replace(
  '<input\n                      type=\"email\"\n                      placeholder=\"ejemplo@gobiernodecanarias.org\"\n                      value={email.address}\n                      onChange={(event) => updateEmail(email.id, { address: event.target.value })}\n                      className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n                    />',
  '<input\n                      type=\"email\"\n                      placeholder=\"ejemplo@gobiernodecanarias.org\"\n                      value={email.address}\n                      onChange={(event) => updateEmail(email.id, { address: event.target.value })}\n                      aria-invalid={!!fieldErrors[\\`contactMethods.emails.\\${index}.address\\`]}\n                      aria-describedby={fieldErrors[\\`contactMethods.emails.\\${index}.address\\`] ? \\`err-email-\\${index}\\` : undefined}\n                      className=\"mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2\"\n                    />'
);
content = content.replace(
  '{fieldErrors[\\`contactMethods.emails.\\${index}.address\\`] && (\n                      <p className=\"mt-2 text-sm text-red-600\">{fieldErrors[\\`contactMethods.emails.\\${index}.address\\`]}</p>\n                    )}',
  '{fieldErrors[\\`contactMethods.emails.\\${index}.address\\`] && (\n                      <p id={\\`err-email-\\${index}\\`} role=\"alert\" className=\"mt-2 text-sm text-red-600\">{fieldErrors[\\`contactMethods.emails.\\${index}.address\\`]}</p>\n                    )}'
);

// submit error
content = content.replace(
  '<div className=\"rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700\">\n            {submitError}\n          </div>',
  '<div role=\"alert\" aria-live=\"assertive\" className=\"rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700\">\n            {submitError}\n          </div>'
);

// P1 Form page undersized touch targets (buttons)
content = content.replace(
  /className="text-sm font-medium text-scs-blue hover:text-scs-blueDark"/g,
  'className="rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"'
);

fs.writeFileSync('src/renderer/pages/ContactFormPage.tsx', content);
"
bash patch_contact_form.sh
rm patch_contact_form.sh
