import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Bot, Database, GitBranch, Headphones, ShieldCheck, Sparkles } from "lucide-react";
import TellioBrand from "@/components/TellioBrand";

const capabilities = [
  {
    icon: GitBranch,
    title: "Design every conversation",
    copy: "Shape intents, prompts, decisions and handoffs in one visual workspace.",
    accent: "bg-[#d9f4e6] text-[#176b4a]",
  },
  {
    icon: Database,
    title: "Connect business knowledge",
    copy: "Ground answers in your catalogues, policies, customer data and live systems.",
    accent: "bg-[#ffe2dd] text-[#9f2f26]",
  },
  {
    icon: ShieldCheck,
    title: "Keep calls on course",
    copy: "Set clear scope, validation and escalation rules for dependable service.",
    accent: "bg-[#e3e8f5] text-[#344b82]",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f7f8f5] text-[#17211d]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/10 bg-[#f7f8f5]/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 md:px-10">
          <Link href="/" aria-label="Tellio home"><TellioBrand /></Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex" aria-label="Primary navigation">
            <a href="#product" className="hover:text-[#cf4135]">Product</a>
            <a href="#capabilities" className="hover:text-[#cf4135]">Capabilities</a>
            <a href="#how-it-works" className="hover:text-[#cf4135]">How it works</a>
            <a href="#contact" className="hover:text-[#cf4135]">Contact</a>
          </nav>
          <Link href="/manager" className="inline-flex h-10 items-center gap-2 bg-[#17211d] px-4 text-sm font-semibold text-white hover:bg-[#2b3832]">
            Log in <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section id="product" className="relative min-h-[92svh] overflow-hidden pt-18">
        <Image
          src="/tellio-voice-operations.jpg"
          alt="Customer service professional managing a call"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[62%_center]"
        />
        <div className="absolute inset-0 bg-[#f7f8f5]/45" />
        <div className="absolute inset-y-0 left-0 w-full bg-[#f7f8f5]/90 md:w-[58%] md:bg-[#f7f8f5]/94" />
        <div className="relative mx-auto flex min-h-[calc(92svh-4.5rem)] max-w-[1440px] items-center px-5 py-16 md:px-10">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 border-l-4 border-[#ef5b4c] bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#39463f]">
              <Sparkles size={14} className="text-[#ef5b4c]" aria-hidden="true" /> Voice service, properly orchestrated
            </div>
            <h1 className="max-w-xl text-5xl font-semibold leading-[0.98] tracking-normal sm:text-6xl md:text-7xl">
              Tellio
            </h1>
            <p className="mt-5 max-w-xl text-2xl font-medium leading-tight text-[#26352e] sm:text-3xl">
              Voice agents that listen, understand and get things done.
            </p>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#52635c] md:text-lg">
              Build dependable customer conversations around your workflows, knowledge and business systems, without enterprise contact-centre overhead.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/manager" className="inline-flex h-12 items-center gap-2 bg-[#ef5b4c] px-5 font-semibold text-white hover:bg-[#d9483b]">
                Open Workflow Manager <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className="inline-flex h-12 items-center border border-[#17211d] bg-white/75 px-5 font-semibold hover:bg-white">
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="border-y border-black/10 bg-white py-20 md:py-28">
        <div className="mx-auto max-w-[1240px] px-5 md:px-10">
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#cf4135]">One operating layer</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">From first hello to resolved outcome.</h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-[#52635c]">
              Tellio brings call design, business context, testing and operational controls together so teams can improve service without rebuilding the stack.
            </p>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden border border-black/10 bg-black/10 md:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, copy, accent }) => (
              <article key={title} className="bg-[#f7f8f5] p-7 md:p-9">
                <span className={`grid h-11 w-11 place-items-center ${accent}`}><Icon size={21} aria-hidden="true" /></span>
                <h3 className="mt-8 text-xl font-semibold">{title}</h3>
                <p className="mt-3 leading-7 text-[#5a6862]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-[#17211d] py-20 text-white md:py-28">
        <div className="mx-auto max-w-[1240px] px-5 md:px-10">
          <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#78d6a5]">How it works</p>
              <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight sm:text-4xl">A clearer path from idea to live call.</h2>
            </div>
            <ol className="grid gap-px bg-white/15 sm:grid-cols-3">
              {[
                ["01", "Describe", "Tell the AI helper what callers need and what a successful outcome looks like."],
                ["02", "Configure", "Review the generated intents, workflows, prompts, data access and guardrails."],
                ["03", "Test", "Run a browser or phone call, inspect the trace, then publish with confidence."],
              ].map(([number, title, copy]) => (
                <li key={number} className="bg-[#202e28] p-7">
                  <span className="font-mono text-sm text-[#78d6a5]">{number}</span>
                  <h3 className="mt-8 text-xl font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#b8c5bf]">{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-[#d9f4e6] py-16 md:py-20">
        <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-8 px-5 md:flex-row md:items-center md:px-10">
          <div className="flex items-start gap-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center bg-white text-[#176b4a]"><Headphones size={24} aria-hidden="true" /></span>
            <div>
              <h2 className="text-2xl font-semibold">Ready to shape your first conversation?</h2>
              <p className="mt-2 text-[#426052]">Sign in to the Workflow Manager and start with the Tellio AI helper.</p>
            </div>
          </div>
          <Link href="/manager" className="inline-flex h-12 shrink-0 items-center justify-center gap-2 bg-[#17211d] px-5 font-semibold text-white hover:bg-[#2b3832]">
            Go to Workflow Manager <Bot size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer id="contact" className="bg-[#f7f8f5] py-10">
        <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-6 px-5 text-sm text-[#52635c] sm:flex-row sm:items-center md:px-10">
          <TellioBrand compact subtitle="Voice orchestration" />
          <div className="flex gap-6"><a href="mailto:hello@tellio.ai" className="hover:text-[#cf4135]">Contact</a><Link href="/manager" className="hover:text-[#cf4135]">Customer login</Link></div>
          <span>© {new Date().getFullYear()} Tellio</span>
        </div>
      </footer>
    </main>
  );
}
