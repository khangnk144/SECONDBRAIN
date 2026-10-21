import type { ReactNode } from 'react';

/** One heading and its controls; the page is a single calm column (no cards). */
export function SettingsSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = `settings-${id}`;
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {intro ? <p className="settings-section__intro">{intro}</p> : null}
      {children}
    </section>
  );
}

/** A labelled row: the control, then its hint and save state below it. */
export function SettingsField({
  label,
  htmlFor,
  hint,
  status,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="settings-field__control">
        {children}
        {status}
      </div>
      {hint ? <div className="settings-field__hint">{hint}</div> : null}
    </div>
  );
}
