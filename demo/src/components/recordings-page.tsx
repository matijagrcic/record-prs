import { useState } from 'react'
import { Film, CheckCircle2, Clock, ArrowUpRight, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const storageKey = 'acme-demo-recording-reviews'
const initialRecordings = [
  {id:'navigation',name:'Workspace navigation',detail:'A tour of the sidebar and project screens',duration:'0:08',reviewed:true,route:'/projects'},
  {id:'account',name:'Account onboarding',detail:'Login and signup, from start to finish',duration:'0:12',reviewed:true,route:'/signup'},
  {id:'overview',name:'Project overview',detail:'Explore the latest workspace activity',duration:'0:06',reviewed:false,route:'/'},
]

function loadRecordings() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const reviews = saved as Record<string, unknown>
      return initialRecordings.map(item => ({
        ...item,
        reviewed: typeof reviews[item.id] === 'boolean' ? reviews[item.id] as boolean : item.reviewed,
      }))
    }
  } catch {
    // Browser storage may be unavailable or contain an older, invalid value.
  }
  return initialRecordings
}

export function RecordingsPage() {
  const [recordings, setRecordings] = useState(loadRecordings)
  const [reviewedOnly, setReviewedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const search = query.trim().toLowerCase()
  const visible = recordings.filter(item =>
    (!reviewedOnly || item.reviewed) && `${item.name} ${item.detail}`.toLowerCase().includes(search)
  )
  const reviewedCount = recordings.filter(item => item.reviewed).length

  function toggleReview(id: string) {
    const updated = recordings.map(item => item.id === id ? {...item, reviewed: !item.reviewed} : item)
    const changed = updated.find(item => item.id === id)!
    setRecordings(updated)
    const message = `${changed.name} marked as ${changed.reviewed ? 'reviewed' : 'pending'}.`
    try {
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(updated.map(item => [item.id, item.reviewed]))))
      setNotice(message)
    } catch {
      setNotice(`${message} Browser storage is unavailable; this change will last until you leave this screen.`)
    }
  }

  function clearFilters() {
    setQuery('')
    setReviewedOnly(false)
  }

  return <div className="mx-auto w-full max-w-6xl space-y-8 p-6 lg:p-10" data-testid="recordings-page">
    <div><p className="mb-2 text-sm text-muted-foreground">Acme Studio / Workspace</p><h1 className="text-3xl font-semibold tracking-tight">Recordings</h1><p className="mt-2 text-muted-foreground">See what changed. Keep the proof beside the work.</p></div>
    <div className="grid gap-4 md:grid-cols-3">{[
      {label:'Demo journeys',value:recordings.length,icon:Film,id:'total'},
      {label:'Reviewed',value:reviewedCount,icon:CheckCircle2,id:'reviewed'},
      {label:'Awaiting review',value:recordings.length - reviewedCount,icon:Clock,id:'pending'},
    ].map(stat => <Card key={stat.id}><CardHeader className="flex flex-row items-center justify-between"><CardDescription>{stat.label}</CardDescription><stat.icon className="size-4 text-muted-foreground"/></CardHeader><CardContent className="text-3xl font-semibold" data-testid={`recordings-${stat.id}`} data-count={stat.value}>{stat.value}</CardContent></Card>)}</div>
    <Card>
      <CardHeader className="gap-4">
        <div><CardTitle>Demo library</CardTitle><CardDescription className="mt-2">Find a journey and track its review. Review status is saved in this browser.</CardDescription></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search aria-hidden="true" className="pointer-events-none absolute top-2 left-3 size-4 text-muted-foreground"/><Input type="search" aria-label="Search recordings" placeholder="Search recordings…" className="pl-9" value={query} onChange={event => setQuery(event.target.value)} data-testid="recordings-search"/></div>
          <Button variant={reviewedOnly ? 'default' : 'outline'} onClick={() => setReviewedOnly(!reviewedOnly)} aria-pressed={reviewedOnly} data-testid="filter-reviewed">{reviewedOnly ? 'Show all' : 'Reviewed only'}</Button>
          {(query || reviewedOnly) && <Button variant="ghost" onClick={clearFilters} data-testid="clear-recording-filters">Clear filters</Button>}
        </div>
      </CardHeader>
      <CardContent data-testid="recordings-list" className="divide-y">
        {visible.map(item => <div key={item.id} className="flex flex-wrap items-center gap-4 py-5" data-testid={`recording-${item.id}`} data-reviewed={item.reviewed}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted"><Film aria-hidden="true" className="size-5"/></div>
          <div className="min-w-0 flex-1 basis-40"><p className="font-medium">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p></div>
          <span className="text-sm tabular-nums text-muted-foreground">{item.duration}</span>
          <Badge variant={item.reviewed ? 'secondary' : 'outline'}>{item.reviewed ? 'Reviewed' : 'Pending'}</Badge>
          <Button variant="outline" size="sm" onClick={() => toggleReview(item.id)} aria-label={`Mark ${item.name} as ${item.reviewed ? 'pending' : 'reviewed'}`} data-testid={`review-${item.id}`}>{item.reviewed ? <Clock aria-hidden="true"/> : <CheckCircle2 aria-hidden="true"/>}{item.reviewed ? 'Mark pending' : 'Mark reviewed'}</Button>
          <Button variant="ghost" size="icon" asChild><a href={`#${item.route}`} aria-label={`Open ${item.name}`}><ArrowUpRight/></a></Button>
        </div>)}
        {visible.length === 0 && <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid="recordings-empty"><Search aria-hidden="true" className="size-8 text-muted-foreground"/><p className="font-medium">No recordings found</p><p className="text-sm text-muted-foreground">Try another search or clear your filters to see every journey.</p><Button variant="outline" onClick={clearFilters}>Show all recordings</Button></div>}
      </CardContent>
    </Card>
    <p className="text-sm text-muted-foreground" data-testid="recordings-count" data-count={visible.length} role="status">Showing {visible.length} of {recordings.length} demo journeys</p>
    <p className="text-sm text-muted-foreground" role="status" data-testid="recording-review-notice">{notice}</p>
  </div>
}
