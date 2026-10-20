// ReadingsList.jsx - measured points, NEWEST FIRST, with a delete button per
// row, plus the CSV export link and the delete-survey button.
// "mode" = how the reading was taken: measure (N s average), walk (3 samples), manual.
// ⚠ marks a reading the calibration flags as obstructed (8+ dB below the model).
import { bandFor } from '../bands.js'

export default function ReadingsList({ surveyId, readings, obstructedIds, onDeleteReading, onDeleteSurvey }) {
  const newestFirst = [...readings].reverse()     // the API returns oldest first
  return (
    <section className="card" aria-labelledby="readings-title">
      <h2 id="readings-title">Readings ({readings.length})</h2>

      {readings.length === 0 ? (
        <p className="muted">No readings yet. Click the map to measure your first spot.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>x, y (m)</th><th>dBm</th><th>±</th><th>n</th><th>mode</th><th><span className="sr-only">Delete</span></th></tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => (
                <tr key={r.id}>
                  <td>{r.x.toFixed(1)}, {r.y.toFixed(1)}</td>
                  <td>
                    <span className="dot" style={{ background: bandFor(r.rssi_mean).color }} />
                    {r.rssi_mean.toFixed(1)}
                    {obstructedIds?.has(r.id) && <span className="obstructed-mark" title="Obstructed: 8+ dB below the path-loss model"> ⚠</span>}
                  </td>
                  <td>{r.rssi_std.toFixed(1)}</td>
                  <td>{r.samples.length}</td>
                  <td className="muted">{r.mode || r.method || ''}</td>
                  <td>
                    <button className="icon" onClick={() => onDeleteReading(r.id)}
                      aria-label={`Delete reading at ${r.x}, ${r.y}`}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row">
        {/* Plain link: the browser downloads the CSV through the Vite proxy */}
        <a className="button" href={`/api/surveys/${surveyId}/export.csv`} download>Export CSV</a>
        <button className="danger" onClick={onDeleteSurvey}>Delete survey</button>
      </div>
    </section>
  )
}
