export type FolderColor = {
    bar: string       // left stripe most saturated
    text: string      // folder names at every depth + top-level folder icon (hex #2)
    subIcon: string   // nested folder icons + file icons inside a coloured group (hex #3)
}

const PALETTE: FolderColor[] = [
    // Red
    { bar: 'border-[#fa5b64]', text: 'text-[#e6aaad]', subIcon: 'text-[#793337]' },
    // Orange
    { bar: 'border-[#fb9544]', text: 'text-[#e8c0a1]', subIcon: 'text-[#7a4c29]' },
    // Yellow
    { bar: 'border-[#fbd131]', text: 'text-[#e4d496]', subIcon: 'text-[#796724]' },
    // Green
    { bar: 'border-[#22dc80]', text: 'text-[#8dd5b1]', subIcon: 'text-[#24784a]' },
    // Cyan
    { bar: 'border-[#22d3dc]', text: 'text-[#8dd0d5]', subIcon: 'text-[#247478]' },
    // Blue
    { bar: 'border-[#4b8ffa]', text: 'text-[#a8c3e8]', subIcon: 'text-[#2a4e7a]' },
    // Purple
    { bar: 'border-[#9b5bfa]', text: 'text-[#c9aae6]', subIcon: 'text-[#4d3379]' },
    // Magenta
    { bar: 'border-[#fa5bce]', text: 'text-[#e6aad4]', subIcon: 'text-[#79337a]' },
]

export function getFolderColor(index: number): FolderColor {
    return PALETTE[index % PALETTE.length]
}