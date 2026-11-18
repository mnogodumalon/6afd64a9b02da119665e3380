import { useMemo, useState } from 'react';
import { IconPlus, IconCheck, IconMapPin, IconUsers, IconCalendarEvent, IconAlertTriangle, IconClipboardList } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor, countOf, decided } from '@/config/plan';
import { INTENTS } from '@/config/intents';
import { extractRecordId } from '@/services/livingAppsService';
import { formatDateTime } from '@/lib/formatters';
import { submissionsOf, topOne } from '@/lib/journey';
import { useClock, gruss, namen } from '@/lib/polish';
import { tx, appLabel } from '@/i18n';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { RecordDoorLink } from '@/components/widgets/RecordDoorLink';
import { Button } from '@/components/ui/button';
import type { Umfragen, Terminvorschlaege } from '@/types/app';

type Filter = 'all' | 'open' | 'closed' | 'noanswer';

interface DateRow { termin: Terminvorschlaege; ja: number; vielleicht: number }
interface PollInfo {
  poll: Umfragen;
  rows: DateRow[];
  top: DateRow | null;
  submissions: number;
  isClosed: boolean;
  finalTermin: Terminvorschlaege | null;
  allPast: boolean;
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { umfragen, terminvorschlaege, antworten } = data;
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');

  const infos = useMemo<PollInfo[]>(() => {
    const nowKey = new Date(clock.getTime());
    const pad = (n: number) => String(n).padStart(2, '0');
    const nowIso = `${nowKey.getFullYear()}-${pad(nowKey.getMonth() + 1)}-${pad(nowKey.getDate())}T${pad(nowKey.getHours())}:${pad(nowKey.getMinutes())}`;
    return umfragen.map(poll => {
      const termine = terminvorschlaege
        .filter(t => extractRecordId(t.fields.umfrage) === poll.record_id)
        .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''));
      const mine = antworten.filter(a => extractRecordId(a.fields.umfrage) === poll.record_id);
      const rows: DateRow[] = termine.map(termin => {
        const forDate = mine.filter(a => extractRecordId(a.fields.terminvorschlag) === termin.record_id);
        return {
          termin,
          ja: forDate.filter(a => a.fields.antwort?.key === 'ja').length,
          vielleicht: forDate.filter(a => a.fields.antwort?.key === 'vielleicht').length,
        };
      });
      const top = topOne(rows, [r => r.ja, r => r.vielleicht], r => r.termin.fields.beginn);
      const isClosed = poll.fields.status?.key === 'geschlossen';
      const finalId = decided('umfragen', 'finaler_termin', poll.fields) ? extractRecordId(poll.fields.finaler_termin) : null;
      return {
        poll,
        rows,
        top,
        submissions: submissionsOf(mine, { names: ['teilnehmer_vorname', 'teilnehmer_nachname'] }).length,
        isClosed,
        finalTermin: finalId ? termine.find(t => t.record_id === finalId) ?? null : null,
        allPast: rows.length > 0 && rows.every(r => (r.termin.fields.beginn ?? '') < nowIso),
      };
    }).sort((a, b) => (b.poll.createdat ?? '').localeCompare(a.poll.createdat ?? ''));
  }, [umfragen, terminvorschlaege, antworten, clock]);

  const open = infos.filter(i => !i.isClosed);
  const closed = infos.filter(i => i.isClosed);
  const noAnswer = open.filter(i => i.submissions === 0);
  const stale = open.filter(i => i.allPast);
  const decidable = open.filter(i => !i.allPast && i.top && i.submissions > 0);

  const closeWith = (i: PollInfo) => {
    if (!i.top) return undefined;
    const go = flowActionFor('umfragen', 'finaler_termin', i.poll.record_id, i.top.termin.record_id);
    return go ? { label: tx('Top-Termin festlegen'), onClick: go } : undefined;
  };

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'umfragen') return undefined;
      const info = infos.find(i => i.poll.record_id === top.record.record_id);
      if (!info || info.isClosed) return undefined;
      return closeWith(info);
    },
  });

  const shown = infos.filter(i =>
    filter === 'open' ? !i.isClosed
      : filter === 'closed' ? i.isClosed
      : filter === 'noanswer' ? !i.isClosed && i.submissions === 0
      : true);

  const flowLive = INTENTS.some(i => i.path === '/intents/umfrage-anlegen');
  const createPoll = () => {
    if (flowLive) window.location.hash = '/intents/umfrage-anlegen';
    else crud.umfragen.openCreate({ status: 'offen' });
  };

  const titleOf = (p: Umfragen) => p.fields.titel ?? appLabel('umfragen');

  const context = (() => {
    if (infos.length === 0) return tx('Lege deine erste Umfrage an und teile den Link mit den Teilnehmenden.');
    if (stale.length > 0) return tx`${namen(stale.map(i => titleOf(i.poll)))} hat nur noch vergangene Termine.`;
    if (decidable.length > 0) return tx`${namen(decidable.map(i => titleOf(i.poll)))} wartet auf deine Entscheidung.`;
    if (noAnswer.length > 0) return tx`Auf ${namen(noAnswer.map(i => titleOf(i.poll)))} hat noch niemand geantwortet.`;
    return tx`Alle offenen Umfragen laufen — zuletzt: ${titleOf(infos[0].poll)}.`;
  })();

  const hero = stale.length > 0 ? (
    <HeroBanner
      icon={<IconAlertTriangle size={18} />}
      action={{ label: tx('Umfrage schließen'), onClick: () => { const go = flowActionFor('umfragen', 'status', stale[0].poll.record_id, 'geschlossen'); if (go) go(); else crud.umfragen.openDetail(stale[0].poll); } }}
    >
      <b>{namen(stale.map(i => titleOf(i.poll)))}</b> {tx('— alle vorgeschlagenen Termine liegen in der Vergangenheit.')}
    </HeroBanner>
  ) : infos.length === 0 ? (
    <HeroBanner
      icon={<IconClipboardList size={48} />}
      action={{ label: tx('Erste Umfrage anlegen'), onClick: createPoll }}
    >
      {tx('Noch keine Umfrage — lege Titel, Ort und Terminvorschläge fest und teile den Link.')}
    </HeroBanner>
  ) : undefined;

  const kpis = infos.length === 0 ? undefined : (
    <StatStrip>
      <StatStripItem
        title={tx('Offen')} value={open.length}
        icon={<IconCalendarEvent size={16} className="text-muted-foreground" />}
        onClick={() => setFilter(f => (f === 'open' ? 'all' : 'open'))} active={filter === 'open'}
      />
      <StatStripItem
        title={tx('Ohne Antwort')} value={noAnswer.length}
        tone={noAnswer.length > 0 ? 'warning' : 'default'}
        icon={<IconUsers size={16} className="text-muted-foreground" />}
        onClick={() => setFilter(f => (f === 'noanswer' ? 'all' : 'noanswer'))} active={filter === 'noanswer'}
      />
      <StatStripItem
        title={tx('Geschlossen')} value={closed.length}
        icon={<IconCheck size={16} className="text-muted-foreground" />}
        onClick={() => setFilter(f => (f === 'closed' ? 'all' : 'closed'))} active={filter === 'closed'}
      />
    </StatStrip>
  );

  const primary = (
    <div className="space-y-4">
      {shown.length === 0 && infos.length > 0 && (
        <div className="rounded-[27px] bg-card p-6 text-center text-sm text-muted-foreground shadow-lg">
          {tx('Keine Umfrage in dieser Auswahl.')}
        </div>
      )}
      {shown.map(i => (
        <article key={i.poll.record_id} className="min-w-0 overflow-hidden rounded-[27px] bg-card p-4 shadow-lg sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => crud.umfragen.openDetail(i.poll)}>
              <h3 className="truncate text-base font-semibold">{titleOf(i.poll)}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {i.poll.fields.ort && <span className="inline-flex min-w-0 items-center gap-1"><IconMapPin size={14} className="shrink-0" /><span className="truncate">{i.poll.fields.ort}</span></span>}
                <span>{countOf('antworten', i.submissions, appLabel('antworten'))}</span>
                <span className={i.isClosed ? 'font-medium text-muted-foreground' : 'font-medium text-emerald-600'}>{i.isClosed ? tx('Geschlossen') : tx('Offen')}</span>
              </p>
            </button>
            {!i.isClosed && closeWith(i) && !i.allPast && (
              <Button size="sm" variant="outline" onClick={closeWith(i)!.onClick}>{closeWith(i)!.label}</Button>
            )}
          </div>

          {i.isClosed && i.finalTermin && (
            <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <b>{tx('Finaler Termin:')}</b> {formatDateTime(i.finalTermin.fields.beginn)}
            </p>
          )}

          {i.rows.length > 0 ? (
            <ul className="mt-3 divide-y rounded-xl border">
              {i.rows.map(r => {
                const isTop = i.top?.termin.record_id === r.termin.record_id;
                return (
                  <li key={r.termin.record_id} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${isTop ? 'bg-emerald-50' : ''}`}>
                    <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => crud.terminvorschlaege.openDetail(r.termin)}>
                      {formatDateTime(r.termin.fields.beginn)}
                      {isTop && <span className="ml-2 text-xs font-medium text-emerald-700">{tx('meiste Ja')}</span>}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <b className="text-emerald-700">{r.ja}</b> {tx('Ja')} · <b className="text-amber-600">{r.vielleicht}</b> {tx('Vielleicht')}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge.')}</p>
          )}

          <RecordDoorLink page="termin-abstimmen" recordId={i.poll.record_id} className="mt-3" />
        </article>
      ))}
    </div>
  );

  const aside = (
    <WorkList
      title={tx('Entscheidung offen')}
      items={decidable.map(i => ({
        id: i.poll.record_id,
        title: titleOf(i.poll),
        secondLine: (
          <>
            <span className="font-medium text-emerald-700">{formatDateTime(i.top!.termin.fields.beginn)}</span>
            <span className="text-muted-foreground"> · {i.top!.ja} {tx('Ja')}</span>
          </>
        ),
        action: closeWith(i),
      }))}
      onItemClick={id => { const p = umfragen.find(u => u.record_id === id); if (p) crud.umfragen.openDetail(p); }}
      empty={{
        text: noAnswer.length > 0 ? tx`Noch keine Antworten bei ${titleOf(noAnswer[0].poll)}.` : tx('Nichts zu entscheiden.'),
        action: { label: tx('Neue Umfrage'), onClick: createPoll },
      }}
    />
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{context}</p>
        </div>
        {(flowLive || crud.umfragen.canWrite) && (
          <Button onClick={createPoll}><IconPlus size={16} className="mr-1 shrink-0" />{tx('Neue Umfrage')}</Button>
        )}
      </header>
      <DashboardGrid variant="split" hero={hero} kpis={kpis} aside={aside} primary={primary} />
      {crud.surfaces}
    </div>
  );
}
