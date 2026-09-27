import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  Archive,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  Hash,
  ImagePlus,
  Info,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  Users,
  X,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

type ChatMessage = {
  id: number
  author: string
  initials: string
  role: string
  time: string
  text: string
  mine?: boolean
  accent?: string
  attachment?: { title: string; meta: string }
}

const initialMessages: ChatMessage[] = [
  {
    id: 1,
    author: "Maya Sharma",
    initials: "MS",
    role: "Client",
    time: "9:18 AM",
    text: "Good morning! The living room wall feels a little darker than we expected. Is that the final paint shade?",
    accent: "bg-[#efe7db] text-[#78634c]",
  },
  {
    id: 2,
    author: "Aarav Mehta",
    initials: "AM",
    role: "Project lead",
    time: "9:24 AM",
    text: "Morning, Maya. This is the first coat, so it will look lighter once it dries. I’ll check it again this afternoon in natural light and share an update.",
    accent: "bg-[#dce9e3] text-[#476657]",
  },
  {
    id: 3,
    author: "Maya Sharma",
    initials: "MS",
    role: "Client",
    time: "9:31 AM",
    text: "That sounds good, thank you. I also found the reference photo we discussed.",
    accent: "bg-[#efe7db] text-[#78634c]",
    attachment: { title: "living-room-reference.jpg", meta: "JPG · 2.4 MB" },
  },
  {
    id: 4,
    author: "You",
    initials: "IK",
    role: "Studio Iksha",
    time: "9:42 AM",
    text: "Thanks, Maya. We’ve added it to the project references. Aarav will compare it with the dried sample before we proceed with the second coat.",
    mine: true,
    accent: "bg-[#dce8e1] text-[#456454]",
  },
]

const projects = [
  { name: "Parash ka Ghar", place: "Bandra, Mumbai", initials: "PG", unread: 2, color: "bg-[#e9e3d9] text-[#79674f]" },
  { name: "Mehta Residence", place: "Juhu, Mumbai", initials: "MR", unread: 0, color: "bg-[#e6e6da] text-[#686b4c]" },
  { name: "Nishank House", place: "Pune, Maharashtra", initials: "NH", unread: 0, color: "bg-[#e4e9ed] text-[#516477]" },
  { name: "The Olive Studio", place: "Andheri, Mumbai", initials: "OS", unread: 0, color: "bg-[#eee1dd] text-[#8a6258]" },
]

const projectThreads: Record<string, ChatMessage[]> = {
  "Parash ka Ghar": initialMessages,
  "Mehta Residence": [
    { id: 11, author: "Nisha Mehta", initials: "NM", role: "Client", time: "Yesterday", text: "Could we move the dining pendant slightly toward the center of the table?", accent: "bg-[#efe7db] text-[#78634c]" },
    { id: 12, author: "Neha Shah", initials: "NS", role: "Interior designer", time: "Yesterday", text: "Absolutely. I’ve updated the reflected ceiling plan and shared the revised drawing in the files tab.", accent: "bg-[#e4e9ed] text-[#516477]", attachment: { title: "ceiling-plan-rev-b.pdf", meta: "PDF · 860 KB" } },
    { id: 13, author: "You", initials: "IK", role: "Studio Iksha", time: "Yesterday", text: "The electrician has the updated plan and will confirm the new point during tomorrow’s site visit.", mine: true, accent: "bg-[#dce8e1] text-[#456454]" },
  ],
  "Nishank House": [
    { id: 21, author: "Dev Nishank", initials: "DN", role: "Client", time: "10:12 AM", text: "We’ve approved the stone sample for the entrance. Please go ahead with this one.", accent: "bg-[#e4e9ed] text-[#516477]" },
    { id: 22, author: "Rohan Kulkarni", initials: "RK", role: "Site supervisor", time: "10:19 AM", text: "Noted. I’ve marked the sample approved and shared it with the stone contractor.", accent: "bg-[#e6e6da] text-[#686b4c]" },
  ],
  "The Olive Studio": [
    { id: 31, author: "Tara Iyer", initials: "TI", role: "Client", time: "9:54 AM", text: "The joinery team asked which handle finish we chose for the reception desk. Is it brushed brass?", accent: "bg-[#eee1dd] text-[#8a6258]" },
    { id: 32, author: "Aarav Mehta", initials: "AM", role: "Project lead", time: "10:02 AM", text: "Yes, brushed brass. I’m sharing the approved specification sheet here so the team has the exact finish code.", accent: "bg-[#dce9e3] text-[#476657]", attachment: { title: "joinery-specification.pdf", meta: "PDF · 1.2 MB" } },
  ],
}

function App() {
  const [activeProject, setActiveProject] = useState(projects[0])
  const [threads, setThreads] = useState(projectThreads)
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [showDetails, setShowDetails] = useState(false)
  const messages = threads[activeProject.name] ?? []
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages, activeProject.name])

  const filteredProjects = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase())),
    [query],
  )

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const now = new Date()
    const message: ChatMessage = {
        id: Date.now(),
        author: "You",
        initials: "IK",
        role: "Studio Iksha",
        time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        text,
        mine: true,
        accent: "bg-[#dce8e1] text-[#456454]",
      }
    setThreads((current) => ({
      ...current,
      [activeProject.name]: [...(current[activeProject.name] ?? []), message],
    }))
    setDraft("")
  }

  return (
    <main className="app-shell flex h-dvh min-h-[620px] overflow-hidden bg-background text-foreground">
      <aside className="workspace-sidebar hidden w-[278px] shrink-0 flex-col border-r border-border/80 bg-[#fbfaf8] md:flex">
        <div className="flex h-[72px] items-center gap-3 px-5">
          <div className="brand-mark flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <span className="font-serif text-lg">i</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold tracking-tight">Studio Iksha</p>
            <p className="text-[11px] text-muted-foreground">Project workspace</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Workspace options" className="size-8 text-muted-foreground">
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <Separator />

        <div className="space-y-1 px-3 py-4">
          <button className="nav-item nav-active flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium">
            <MessageCircle className="size-4" /> <span className="flex-1">Messages</span>
            <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px]">2</span>
          </button>
          <button className="nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-muted-foreground">
            <Users className="size-4" /> <span className="flex-1">People</span>
          </button>
          <button className="nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-muted-foreground">
            <Archive className="size-4" /> <span className="flex-1">Files & resources</span>
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between px-5 pb-2">
          <p className="section-label">PROJECT CHATS</p>
          <Button variant="ghost" size="icon" aria-label="Add project" className="size-7 text-muted-foreground">
            <Plus className="size-4" />
          </Button>
        </div>
        <label className="search-field mx-4 mb-2 flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-white px-2.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a project" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70" />
          <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">⌘ K</span>
        </label>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="Project conversations">
          {filteredProjects.map((project) => (
            <button
              key={project.name}
              onClick={() => setActiveProject(project)}
              className={`project-row flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition-colors ${activeProject.name === project.name ? "project-active" : "hover:bg-black/[0.035]"}`}
            >
              <Avatar className={`size-9 rounded-xl ${project.color}`}><AvatarFallback className={`rounded-xl text-[11px] font-semibold ${project.color}`}>{project.initials}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium">{project.name}</span>
                  {project.unread > 0 && <span className="size-1.5 rounded-full bg-primary" />}
                </span>
                <span className="mt-1 block truncate text-[10px] text-muted-foreground">{project.place}</span>
              </span>
            </button>
          ))}
          {filteredProjects.length === 0 && <p className="px-3 py-5 text-xs text-muted-foreground">No matching projects</p>}
        </nav>

        <div className="mx-3 mb-3 rounded-xl border border-border/70 bg-white p-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-md bg-[#f2efe9] p-1.5 text-[#83745b]"><CircleHelp className="size-3.5" /></div>
            <div><p className="text-[11px] font-medium">Need a hand?</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Visit the team guide for tips and answers.</p></div>
          </div>
        </div>
        <button className="flex items-center gap-3 border-t border-border/70 px-5 py-4 text-left hover:bg-black/[0.02]">
          <Avatar className="size-8"><AvatarFallback className="bg-[#284f3d] text-[10px] text-white">IK</AvatarFallback></Avatar>
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Ishita Kapoor</span><span className="block text-[10px] text-muted-foreground">Studio admin</span></span>
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </button>
      </aside>

      <section className="conversation-panel flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border/80 bg-white/90 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="project-heading hidden min-w-0 items-center gap-3 md:flex">
              <Avatar className={`size-9 rounded-xl ${activeProject.color}`}><AvatarFallback className={`rounded-xl text-[11px] font-semibold ${activeProject.color}`}>{activeProject.initials}</AvatarFallback></Avatar>
              <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-[14px] font-semibold tracking-tight">{activeProject.name}</h1><span className="rounded-full bg-[#edf3ee] px-2 py-0.5 text-[9px] font-medium text-[#4e735e]">On track</span></div><p className="mt-0.5 text-[11px] text-muted-foreground">{activeProject.place} <span className="px-1">·</span> Interior renovation</p></div>
            </div>
            <label className="mobile-project-picker relative flex min-w-0 flex-1 items-center md:hidden">
              <select value={activeProject.name} onChange={(event) => setActiveProject(projects.find((project) => project.name === event.target.value) ?? projects[0])} aria-label="Choose project chat" className="w-full appearance-none truncate rounded-lg bg-transparent py-2 pr-6 text-[13px] font-semibold outline-none">
                {projects.map((project) => <option key={project.name} value={project.name}>{project.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 size-4 text-muted-foreground" />
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="mr-2 hidden items-center -space-x-2 sm:flex">
              <Avatar className="size-7 ring-2 ring-white"><AvatarFallback className="bg-[#efe7db] text-[9px] text-[#78634c]">MS</AvatarFallback></Avatar>
              <Avatar className="size-7 ring-2 ring-white"><AvatarFallback className="bg-[#dce9e3] text-[9px] text-[#476657]">AM</AvatarFallback></Avatar>
              <span className="ml-1 flex size-7 items-center justify-center rounded-full bg-[#f0efec] text-[9px] text-muted-foreground ring-2 ring-white">+3</span>
            </div>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="size-9 text-muted-foreground"><Bell className="size-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Toggle project details" onClick={() => setShowDetails(!showDetails)} className={`size-9 ${showDetails ? "text-primary" : "text-muted-foreground"}`}><Info className="size-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="More chat options" className="size-9 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
          </div>
        </header>

        <div ref={scrollContainerRef} className="chat-scroll flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[780px] px-5 pb-8 pt-7 sm:px-10">
            <div className="mb-7 flex items-center gap-3"><Separator className="flex-1" /><span className="date-divider">TODAY · 27 SEP</span><Separator className="flex-1" /></div>
            <div className="space-y-6" aria-live="polite" aria-label="Project messages">
              {messages.map((message, index) => {
                const previous = messages[index - 1]
                const grouped = previous?.author === message.author
                return (
                  <Message key={message.id} align={message.mine ? "end" : "start"} className={grouped ? "-mt-3" : ""}>
                    <MessageAvatar className={grouped ? "invisible" : ""}>
                      <Avatar className="size-8"><AvatarFallback className={`text-[9px] font-semibold ${message.accent}`}>{message.initials}</AvatarFallback></Avatar>
                    </MessageAvatar>
                    <MessageContent className="max-w-[min(82%,600px)] gap-1.5">
                      {!grouped && <MessageHeader className={`gap-2 px-1 ${message.mine ? "justify-end" : ""}`}><span className="text-[11px] font-semibold text-foreground">{message.author}</span><span className="text-[10px] font-normal">{message.role}</span><span className="text-[10px] font-normal">· {message.time}</span></MessageHeader>}
                      <Bubble variant={message.mine ? "tinted" : "secondary"} align={message.mine ? "end" : "start"} className="max-w-full">
                        <BubbleContent className="px-3.5 py-2.5 text-[12px] leading-[1.7]">{message.text}</BubbleContent>
                      </Bubble>
                      {message.attachment && <div className={`attachment-card flex w-fit items-center gap-3 rounded-xl border border-border/70 bg-white px-3 py-2.5 ${message.mine ? "ml-auto" : ""}`}><div className="rounded-lg bg-[#f1eee8] p-2 text-[#887458]"><ImagePlus className="size-4" /></div><div><p className="text-[10px] font-medium">{message.attachment.title}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{message.attachment.meta}</p></div><Button variant="ghost" size="icon" aria-label="Open attachment" className="size-7 text-muted-foreground"><FileText className="size-3.5" /></Button></div>}
                      <MessageFooter className="min-h-3 px-1 text-[9px] font-normal">{message.mine ? <span className="inline-flex items-center gap-1">Seen by 4 <Check className="size-3 text-primary" /></span> : grouped ? null : null}</MessageFooter>
                    </MessageContent>
                  </Message>
                )
              })}
            </div>
            <div className="my-6 flex items-center gap-3"><Separator className="flex-1" /><span className="date-divider text-primary">NEW MESSAGES</span><Separator className="flex-1" /></div>
            <Message>
              <MessageAvatar><Avatar className="size-8"><AvatarFallback className="bg-[#e6e6da] text-[9px] font-semibold text-[#686b4c]">RK</AvatarFallback></Avatar></MessageAvatar>
              <MessageContent className="max-w-[min(82%,600px)] gap-1.5">
                <MessageHeader className="gap-2 px-1"><span className="text-[11px] font-semibold text-foreground">Rohan Kulkarni</span><span className="text-[10px] font-normal">Site supervisor</span><span className="text-[10px] font-normal">· 10:06 AM</span></MessageHeader>
                <Bubble variant="secondary"><BubbleContent className="px-3.5 py-2.5 text-[12px] leading-[1.7]">The second coat is scheduled for tomorrow morning. I’ll post a photo once it’s dry so we can confirm the shade together.</BubbleContent></Bubble>
                <MessageFooter className="px-1 text-[9px] font-normal"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#72a783]" />Just now</span></MessageFooter>
              </MessageContent>
            </Message>
          </div>
        </div>

        <div className="composer-wrap shrink-0 px-5 pb-5 pt-2 sm:px-10">
          <form onSubmit={sendMessage} className="composer mx-auto max-w-[780px] rounded-2xl border border-border bg-white p-2 shadow-[0_5px_24px_-18px_rgba(35,45,37,0.35)] focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/5">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={`Message ${activeProject.name}…`} rows={2} className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2.5 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/70" aria-label="Write a message" />
            <div className="flex items-center justify-between border-t border-border/60 px-1 pt-2">
              <div className="flex items-center gap-0.5"><Button type="button" variant="ghost" size="icon" aria-label="Attach a file" className="size-8 text-muted-foreground"><Paperclip className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Add emoji" className="size-8 text-muted-foreground"><Smile className="size-4" /></Button><span className="mx-1 h-4 border-l border-border" /><button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"><Hash className="size-3" /> General <ChevronDown className="size-3" /></button></div>
              <div className="flex items-center gap-2"><span className="hidden text-[9px] text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line</span><Button type="submit" size="icon" aria-label="Send message" disabled={!draft.trim()} className="size-8 rounded-lg"><Send className="size-3.5" /></Button></div>
            </div>
          </form>
          <p className="mx-auto mt-2 max-w-[780px] text-center text-[9px] text-muted-foreground">Keep project decisions and updates in this conversation so everyone stays in the loop.</p>
        </div>
      </section>

      <aside className={`project-details ${showDetails ? "mobile-details-open" : "hidden"} w-[270px] shrink-0 flex-col border-l border-border/80 bg-[#fbfaf8] xl:flex`}>
        <div className="flex h-[72px] items-center justify-between border-b border-border/80 px-5"><p className="text-[12px] font-semibold">Project details</p><Button variant="ghost" size="icon" aria-label="Close project details" onClick={() => setShowDetails(false)} className="size-8 text-muted-foreground"><X className="size-4" /></Button></div>
        <div className="overflow-y-auto p-5">
          <div className="rounded-2xl border border-border/70 bg-white p-4">
            <Avatar className={`mb-3 size-11 rounded-xl ${activeProject.color}`}><AvatarFallback className={`rounded-xl text-sm font-semibold ${activeProject.color}`}>{activeProject.initials}</AvatarFallback></Avatar>
            <h2 className="text-[13px] font-semibold">{activeProject.name}</h2><p className="mt-1 text-[10px] text-muted-foreground">{activeProject.place}</p>
            <div className="mt-4 flex items-center justify-between"><span className="text-[10px] text-muted-foreground">Project status</span><span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#547b60]"><span className="size-1.5 rounded-full bg-[#72a783]" />On track</span></div>
            <Separator className="my-3" /><div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">Target completion</span><span className="text-[10px] font-medium">18 Dec 2026</span></div>
          </div>

          <div className="mt-6"><div className="mb-3 flex items-center justify-between"><p className="section-label">TEAM · 5</p><Button variant="ghost" size="icon" aria-label="Add teammate" className="size-7 text-muted-foreground"><Plus className="size-3.5" /></Button></div>
            <div className="space-y-3.5">
              {[{ name: "Maya Sharma", role: "Client", initials: "MS", color: "bg-[#efe7db] text-[#78634c]", online: true }, { name: "Aarav Mehta", role: "Project lead", initials: "AM", color: "bg-[#dce9e3] text-[#476657]", online: true }, { name: "Rohan Kulkarni", role: "Site supervisor", initials: "RK", color: "bg-[#e6e6da] text-[#686b4c]", online: false }, { name: "Neha Shah", role: "Interior designer", initials: "NS", color: "bg-[#e4e9ed] text-[#516477]", online: false }].map((person) => <div key={person.name} className="flex items-center gap-2.5"><div className="relative"><Avatar className="size-8"><AvatarFallback className={`text-[9px] font-semibold ${person.color}`}>{person.initials}</AvatarFallback></Avatar>{person.online && <span className="absolute right-0 bottom-0 size-2 rounded-full border-2 border-[#fbfaf8] bg-[#73a783]" />}</div><div><p className="text-[10px] font-medium">{person.name}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{person.role}</p></div></div>)}
            </div>
          </div>

          <div className="mt-7"><div className="mb-3 flex items-center justify-between"><p className="section-label">PINNED FILES</p><button className="text-[9px] font-medium text-primary">See all</button></div><div className="space-y-2"><button className="file-row flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-white p-2.5 text-left"><span className="rounded-md bg-[#f3eee6] p-1.5 text-[#91764f]"><FileText className="size-3.5" /></span><span className="min-w-0"><span className="block truncate text-[9px] font-medium">Living room · moodboard</span><span className="mt-0.5 block text-[8px] text-muted-foreground">Updated yesterday</span></span></button><button className="file-row flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-white p-2.5 text-left"><span className="rounded-md bg-[#eaf0eb] p-1.5 text-[#62806c]"><ImagePlus className="size-3.5" /></span><span className="min-w-0"><span className="block truncate text-[9px] font-medium">Paint samples · 4 photos</span><span className="mt-0.5 block text-[8px] text-muted-foreground">Added 24 Sep</span></span></button></div></div>

          <div className="mt-7 rounded-xl bg-[#f1efe9] p-3.5"><div className="flex items-center gap-2"><div className="rounded-md bg-white p-1.5 text-[#80745f]"><Check className="size-3.5" /></div><p className="text-[10px] font-medium">Current milestone</p></div><p className="mt-2 text-[11px] font-medium">Painting & finishes</p><p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">Second coat begins tomorrow morning.</p><button className="mt-3 text-[9px] font-medium text-primary">View project plan →</button></div>
        </div>
      </aside>
    </main>
  )
}

export default App
