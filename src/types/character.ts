export interface Character {
  id: string
  storyId: string
  name: string
  aliases: string[]
  isProtagonist: boolean
  description: string | null
  dialogueStyle: string | null
  createdAt: number
}
