# Custom dropdowns / comboboxes

Native `<select>` works with `agent-chrome select @eN "value"`. Custom dropdowns
(Headless UI combobox, React Select, MUI Autocomplete) don't — they're `<div>`s
with ARIA roles and keyboard-driven state machines.

## Symptom

- Clicking the trigger opens the menu, but clicking an option does nothing.
- `fill @eN "foo"` types into the search box but no option gets selected.
- Options appear in a portal (`<body>` last-child), not as children of the
  trigger.

## Recipe: keyboard-first

This is the most reliable pattern and works with nearly every framework.

```bash
agent-chrome click @eN                 # trigger the combobox
agent-chrome fill @eN "united"         # or: type @eN
agent-chrome press ArrowDown           # highlight first match
agent-chrome press Enter               # commit
```

For options that don't filter by typing, step through them:

```bash
agent-chrome click @eN
agent-chrome press ArrowDown
agent-chrome press ArrowDown
agent-chrome press ArrowDown
agent-chrome press Enter
```

## Recipe: click the option

If keyboard doesn't work, the options are rendered in a portal. Re-snapshot
after opening the dropdown:

```bash
agent-chrome click @eN          # open
agent-chrome snapshot -ic       # options now have their own refs
agent-chrome click @e47         # click the option ref
```

## Gotcha

Some comboboxes (Headless UI, Radix) only commit the selection on `Enter` or
`Tab` — clicking an option highlights it but doesn't commit. If the form
reverts after `click @eN`, press `Enter` afterwards.
