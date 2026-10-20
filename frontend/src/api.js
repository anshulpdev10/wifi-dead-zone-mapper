// api.js - small wrapper around fetch() for talking to the Flask backend.
// Every backend error comes back as JSON {"error": "..."}; we turn that into
// a JavaScript Error so components can show err.message.

async function request(method, path, body) {
  const options = { method, headers: {} }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch('/api' + path, options)
  } catch {
    throw new Error('Cannot reach the backend. Is app.py running on port 5000?')
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`)
  }
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
}
