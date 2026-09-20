export default function AdminLoading() {
  return <div aria-busy="true" aria-live="polite">
    <header className="admin-heading"><div><small>CARREGANDO</small><h1>&nbsp;</h1></div></header>
    <section className="metric-grid">{Array.from({length:12},(_,index)=><article className="metric-card admin-skeleton" key={index}><span>&nbsp;</span><strong>&nbsp;</strong></article>)}</section>
    <section className="admin-section"><div className="admin-table-wrap admin-skeleton" style={{minHeight:240}}/></section>
  </div>;
}
