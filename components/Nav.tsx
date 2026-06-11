"use client";
import { useState } from "react";
import Link from "next/link";

const MAIN_LINKS = [
  { href: "/products",    label: "Products",         key: "products" },
  { href: "/bulk",        label: "Bulk Assign / Review", key: "bulk" },
  { href: "/library",     label: "Why Choose This",   key: "library" },
  { href: "/library?tab=perfect", label: "Perfect For", key: "perfect-for" },
  { href: "/product-types",       label: "Product Types", key: "product-types" },
  { href: "/quality-report",      label: "Content Report", key: "quality-report" },
];

const PF_SUB_LINKS = [
  { href: "/library?tab=perfect",  label: "Phrases",           key: "phrases" },
  { href: "/settings/keywords",    label: "Interest Filter",    key: "keywords" },
  { href: "/icons",                label: "Icons",              key: "icons" },
  { href: "/settings",             label: "Seasonal Settings",  key: "seasonal" },
];

export default function Nav({ active, subActive, helpText }: { active: string; subActive?: string; helpText?: string }) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="shrink-0">
      <nav className="bg-white border-b border-gray-200 px-6 flex items-end gap-1">
        {MAIN_LINKS.map(({ href, label, key }) => (
          <Link
            key={key}
            href={href}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active === key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </Link>
        ))}
        {helpText && (
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto mb-2.5 w-5 h-5 rounded-full border border-gray-500 text-gray-600 text-xs font-medium hover:border-gray-700 hover:text-gray-800 flex items-center justify-center shrink-0"
            aria-label="Help"
          >
            ?
          </button>
        )}
      </nav>
      {active === "perfect-for" && (
        <nav className="bg-gray-50 border-b border-gray-200 px-6 flex items-end gap-1">
          {PF_SUB_LINKS.map(({ href, label, key }) => (
            <Link
              key={key}
              href={href}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subActive === key
                  ? "border-gray-700 text-gray-800"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      {showHelp && helpText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">How this works</h2>
              <button
                onClick={() => setShowHelp(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{helpText}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
