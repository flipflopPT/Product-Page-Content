import Link from "next/link";

const links = [
  { href: "/products", label: "Products", key: "products" },
  { href: "/bulk", label: "Bulk Assign", key: "bulk" },
  { href: "/bulk-review", label: "Bulk Review", key: "bulk-review" },
  { href: "/library", label: "Phrase Library", key: "library" },
  { href: "/icons", label: "Perfect For Icons", key: "icons" },
  { href: "/settings", label: "Seasonal Settings", key: "settings" },
];

export default function Nav({ active }: { active: string }) {
  return (
    <nav className="bg-white border-b border-gray-200 px-6 flex items-end gap-1 shrink-0">
      <span className="font-semibold text-gray-900 mr-6 pb-3 text-sm">Product Page Content</span>
      {links.map(({ href, label, key }) => (
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
    </nav>
  );
}
