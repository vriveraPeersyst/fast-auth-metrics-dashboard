"use client";

import { useState } from "react";

export function Disclosure({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="logsPanel">
      <button
        type="button"
        className="disclosureToggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="panelTitleRow" style={{ marginBottom: 0 }}>
          <div>
            <h2>{title}</h2>
            {description ? <p className="disclosureDesc">{description}</p> : null}
          </div>
          <span className="disclosureCaret" data-open={open}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </button>
      {open ? <div className="disclosureBody">{children}</div> : null}
    </section>
  );
}
