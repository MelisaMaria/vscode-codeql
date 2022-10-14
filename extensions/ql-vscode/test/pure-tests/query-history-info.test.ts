import { expect } from 'chai';

import { QueryStatus } from '../../src/query-status';
import { getRawQueryName } from '../../src/query-history-info';
import { VariantAnalysisHistoryItem } from '../../src/remote-queries/variant-analysis-history-item';
import { createMockVariantAnalysis } from '../../src/vscode-tests/factories/remote-queries/shared/variant-analysis';
import { createMockLocalQueryInfo } from '../../src/vscode-tests/factories/local-queries/local-query-history-item';
import { createMockRemoteQueryHistoryItem } from '../../src/vscode-tests/factories/remote-queries/remote-query-history-item';

describe('Query history info', () => {
  describe('getRawQueryName', () => {
    it('should get the name for local history items', () => {
      const date = new Date('2022-01-01T00:00:00.000Z');
      const dateStr = date.toLocaleString();

      const queryHistoryItem = createMockLocalQueryInfo(dateStr);

      const queryName = getRawQueryName(queryHistoryItem);

      expect(queryName).to.equal(queryHistoryItem.getQueryName());
    });

    it('should get the name for remote query history items', () => {
      const queryHistoryItem = createMockRemoteQueryHistoryItem({});
      const queryName = getRawQueryName(queryHistoryItem);

      expect(queryName).to.equal(queryHistoryItem.remoteQuery.queryName);
    });

    it('should get the name for variant analysis history items', () => {
      const queryHistoryItem: VariantAnalysisHistoryItem = {
        t: 'variant-analysis',
        status: QueryStatus.InProgress,
        completed: false,
        variantAnalysis: createMockVariantAnalysis()
      };

      const queryName = getRawQueryName(queryHistoryItem);

      expect(queryName).to.equal(queryHistoryItem.variantAnalysis.query.name);
    });
  });
});
