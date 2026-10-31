import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { catalogueApi } from '../../api/endpoints';
import { CATALOGUE_TEMPLATES } from '../../components/catalogue/templates';
import Spinner from '../../components/ui/Spinner';
import type { PublicCatalogue } from '../../types';

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light flex min-h-screen items-center justify-center bg-[#fbf8f1] px-6 text-center text-[15px] text-[#5e574c]">
      <div>{children}</div>
    </div>
  );
}

/** The link customers open. No login, no app menu: just the shop's catalogue. ?print=1 opens the print dialog. */
export default function PublicCataloguePage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const [cat, setCat] = useState<PublicCatalogue | null>(null);
  const [error, setError] = useState<{ missing: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    catalogueApi
      .publicGet(token)
      .then((c) => !cancelled && setCat(c))
      .catch((e) => !cancelled && setError({ missing: e instanceof ApiError && (e.status === 404 || e.status === 400) }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!cat) return;
    const prevTitle = document.title;
    document.title = `${cat.title || 'Catalogue'} · ${cat.shop.name}`;
    // Shared links shouldn't show up in search engines.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => {
      document.title = prevTitle;
      robots.remove();
    };
  }, [cat]);

  const print = params.get('print') === '1';
  useEffect(() => {
    if (!cat || !print) return;
    // Give the template and the logo a moment to render first.
    const t = setTimeout(() => window.print(), 800);
    return () => clearTimeout(t);
  }, [cat, print]);

  if (error) {
    return (
      <Centre>
        {error.missing ? (
          <>
            <p className="font-serif text-[22px] text-[#1e1b16]">This catalogue link isn't available</p>
            <p className="mt-2">The shop may have turned it off or sent a newer link. Please ask them for the latest one.</p>
          </>
        ) : (
          <p>Couldn't load the catalogue. Check your connection and try again.</p>
        )}
      </Centre>
    );
  }
  const loading = (
    <Centre>
      <Spinner className="mx-auto h-5 w-5" />
    </Centre>
  );
  if (!cat) return loading;

  const { Component } = CATALOGUE_TEMPLATES[cat.template] ?? CATALOGUE_TEMPLATES.classic;
  return (
    <Suspense fallback={loading}>
      <Component cat={cat} />
    </Suspense>
  );
}
