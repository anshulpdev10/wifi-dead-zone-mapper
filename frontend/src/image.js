// image.js - shrink a floor-plan image in the browser before upload
// (max 1400 px, JPEG) so the database row stays small.
const MAX_SIDE = 1400

// Read a File, draw it on a canvas at most 1400 px wide/high, return a JPEG data URL.
export function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'                     // transparent PNGs -> white
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')) }
    img.src = url
  })
}
