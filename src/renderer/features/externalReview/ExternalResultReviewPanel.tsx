import styles from './ExternalResultReviewPanel.module.css'
import { useI18n } from '../../i18n'

export interface ExternalReviewFixture {
  sourceName: string
  status: 'validated' | 'invalid'
  differences: Array<{ id: string; owner: string; summary: string }>
  diagnostics: Array<{ code: string; message: string }>
}

export const gateBExternalReviewFixture: ExternalReviewFixture = {
  sourceName: 'candidate-result.json',
  status: 'validated',
  differences: [
    { id: 'diff-1', owner: 'First.xlsx / items', summary: '2 values differ from the local result' },
    { id: 'diff-2', owner: 'Second.xlsx / totals', summary: '1 candidate row has no local match' },
  ],
  diagnostics: [{ code: 'evidence-unavailable', message: 'Workbook evidence is unavailable for one difference.' }],
}

export function ExternalResultReviewPanel({ fixture = gateBExternalReviewFixture }: { fixture?: ExternalReviewFixture }) {
  const { t } = useI18n()
  return (
    <div className={styles.panel} data-testid="external-review-panel">
      <div className={styles.status}>
        <strong>{fixture.sourceName}</strong>
        <span>{fixture.status}</span>
      </div>
      <section className={styles.section} aria-labelledby="gate-b-review-differences">
        <h3 id="gate-b-review-differences">{t('review.queue')}</h3>
        {fixture.differences.map(item => (
          <div className={styles.difference} key={item.id}>
            <strong>{item.owner}</strong>
            <span>{item.summary}</span>
          </div>
        ))}
      </section>
      <section className={styles.section} aria-labelledby="gate-b-review-diagnostics">
        <h3 id="gate-b-review-diagnostics">{t('review.diagnostics')}</h3>
        {fixture.diagnostics.map(item => (
          <div className={styles.diagnostic} key={item.code}>{item.code}: {item.message}</div>
        ))}
      </section>
    </div>
  )
}
