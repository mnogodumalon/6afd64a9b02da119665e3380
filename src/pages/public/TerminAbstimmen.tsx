import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PublicShell } from '@/components/PublicShell';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import { OptionVote } from '@/components/blocks/OptionVote';
import { VOTES, fieldLookup, fieldRef, fieldText, useLiveList } from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import { loadPublicPagesConfig, type PublicPageConfig, type PublicPagesConfig } from '@/lib/publicClient';
import { tx } from '@/i18n';

const SLUG = 'termin-abstimmen';

export default function TerminAbstimmen() {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage');
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      setCfg(c);
      setPage(c?.pages[SLUG] ?? null);
      setLoading(false);
    });
  }, []);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);
  const enabled = !!port && !!linkedId;
  const umfragen = useLiveList(port, 'umfragen', { enabled });
  const termine = useLiveList(port, 'terminvorschlaege', { enabled });

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }

  const shellProps = { title: page.title, description: page.description };

  if (!linkedId) {
    return (
      <PublicShell {...shellProps}>
        <p className="text-sm text-muted-foreground">
          {tx('Bitte öffne die Umfrage über den Link oder QR-Code, den du erhalten hast.')}
        </p>
      </PublicShell>
    );
  }

  const gone = (
    <PublicShell {...shellProps}>
      <p className="text-sm">{tx('Dieser Link ist nicht mehr gültig. Bitte den aktuellen Link oder QR-Code verwenden.')}</p>
    </PublicShell>
  );

  const err = !umfragen.loaded ? umfragen.error : null;
  if (err) {
    if (err.name === 'PageUnavailableError') return gone;
    return (
      <PublicShell {...shellProps}>
        <LoadProblem onRetry={umfragen.reload} />
      </PublicShell>
    );
  }
  if (!umfragen.loaded) return <PublicShell loading />;

  const umfrage = umfragen.records.find(r => r.id === linkedId);
  if (!umfrage) return gone;

  const closed = fieldLookup(umfrage, 'status')?.key === 'geschlossen';
  const finalId = fieldRef(umfrage, 'finaler_termin');
  const finalTermin = closed && finalId
    ? termine.records.find(t => t.id === finalId && fieldRef(t, 'umfrage') === linkedId)
    : undefined;
  const beschreibung = fieldText(umfrage, 'beschreibung');
  const ort = fieldText(umfrage, 'ort');

  return (
    <PublicShell {...shellProps}>
      <div className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold break-words">{fieldText(umfrage, 'titel')}</h2>
          {beschreibung && <p className="text-sm text-muted-foreground whitespace-pre-line break-words">{beschreibung}</p>}
          {ort && <p className="text-sm break-words">{tx('Ort')}: {ort}</p>}
        </header>
        {closed && finalTermin && (
          <div className="rounded-xl border bg-muted/40 p-4 text-sm">
            <p className="font-medium">{tx('Finaler Termin')}</p>
            <p>{fieldText(finalTermin, 'beginn')} – {fieldText(finalTermin, 'ende')}</p>
          </div>
        )}
        <OptionVote port={port} vote={VOTES['termin-abstimmen']} parentId={linkedId} draftKey='termin-abstimmen' closed={closed} />
      </div>
    </PublicShell>
  );
}
