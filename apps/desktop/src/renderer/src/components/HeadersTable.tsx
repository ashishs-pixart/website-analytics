export function HeadersTable({ headers }: { headers: Record<string, unknown> }) {
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return <p className="k">No headers captured.</p>;

  return (
    <table className="headers-table">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <td>{key}</td>
            <td>{String(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
