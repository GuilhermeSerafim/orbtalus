"use client"

import { useRef, useState } from "react"
import styles from "@/app/page.module.css"

const links = [
  { href: "#como-funciona", label: "O fluxo" },
  { href: "#exemplo", label: "Exemplo e alcance" },
  { href: "#conversa", label: "Conversar", highlighted: true },
]

export function LandingNavigation() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <nav className={styles.navigation} aria-label="Navegação principal"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false)
          trigger.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button ref={trigger} className={styles.menuToggle} type="button" aria-expanded={open} aria-controls="landing-navigation" onClick={() => setOpen(!open)}>
        {open ? "Fechar" : "Menu"}<span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <ul className={styles.navLinks} id="landing-navigation" data-open={open}>
        {links.map((link) => (
          <li key={link.href}><a className={link.highlighted ? styles.navCta : undefined} href={link.href} onClick={() => {
            setOpen(false)
            document.getElementById(link.href.slice(1))?.focus({ preventScroll: true })
          }}>{link.label}{link.highlighted && <span aria-hidden="true">↗</span>}</a></li>
        ))}
      </ul>
    </nav>
  )
}
