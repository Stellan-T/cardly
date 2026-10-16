import biology from '../../../samples/biology.txt?raw'
import dutch from '../../../samples/dutch-history.txt?raw'
import spanish from '../../../samples/spanish-english.txt?raw'

export interface Sample {
  id: string
  title: string
  description: string
  text: string
  termLang: string
  defLang: string
}

export const SAMPLES: Sample[] = [
  {
    id: 'biology',
    title: 'Biology: cells and energy',
    description: '32 terms written as “term: definition”',
    text: biology,
    termLang: 'en',
    defLang: 'en',
  },
  {
    id: 'spanish',
    title: 'Spanish–English vocabulary',
    description: '20 words in tab-separated export format',
    text: spanish,
    termLang: 'es',
    defLang: 'en',
  },
  {
    id: 'dutch',
    title: 'Vaderlandse geschiedenis',
    description: 'Dutch history notes with bullets and multi-line definitions',
    text: dutch,
    termLang: 'nl',
    defLang: 'nl',
  },
]
