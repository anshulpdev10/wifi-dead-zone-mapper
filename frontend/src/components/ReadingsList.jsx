// ReadingsList.jsx - table of measured points with a delete button per row,
// plus the CSV export link and the delete-survey button.
import { bandFor } from '../bands.js'

export default function ReadingsList({ surveyId, readings, onDeleteReading, onDeleteSurvey }) {
  return (
    <section className="card" aria-labelledby="readings-title">
      <h2 id="readings-title">Readings ({readings.length})</h2>

      {readings.length === 0 ? (
        <p className="muted">No readings yet. Click the map, then “Measure here”.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>x, y (m)</th><th>dBm</th><th>±</th><th>n</th><th><span className="sr-only">Delete</span></th></tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr key={r.id}>
                  <td>{r.x.toFixed(1)}, {r.y.toFixed(1)}</td>
                  <td>
                    <span className="dot" style={{ background: bandFor(r.rssi_mean).color }} />
                    {r.rssi_mean.toFixed(1)}
                  </td>
                  <td>{r.rssi_std.toFixed(1)}</td>
                  <td>{r.samples.length}</td>
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
