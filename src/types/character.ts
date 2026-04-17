export interface Character {
  id: string
  storyId: string
  name: string
  description: string | null
  dialogueStyle: string | null
  createdAt: number
}

export interface CharacterCreateInput {
  storyId: string
  name: string
  description?: string
  dialogueStyle?: string
}
