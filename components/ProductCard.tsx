import type { Route } from "next";
import Link from "next/link";

import type { Product } from "@/lib/types";

type ProductCardProps = {
  product: Product;
  href?: Route;
};

export function ProductCard({ product, href = "/quiz" }: ProductCardProps) {
  return (
    <article className="card-surface flex h-full flex-col p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-burgundy">
          {product.highlight}
        </span>
        <span className="text-lg font-semibold text-burgundy">{product.price}</span>
      </div>
      <h3 className="text-2xl text-ink">{product.name}</h3>
      <p className="mt-3 text-sm uppercase tracking-[0.2em] text-bottle/80">
        {product.audience}
      </p>
      <p className="mt-4 flex-1 leading-7 text-ink/75">{product.description}</p>
      <Link
        href={href}
        className="mt-6 inline-flex rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy transition hover:border-burgundy hover:bg-burgundy hover:text-cream"
      >
        {product.cta}
      </Link>
    </article>
  );
}
