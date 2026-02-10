import {
  TaxFormData,
  ParsedDocument,
  ReconciliationResult,
  ReviewIssue,
  PriorYearDifference,
  ScheduleReconciliation,
  DocumentCoverage,
  ReconciliationSummary,
  AttributedDocument,
  IncomeItem,
  DeductionItem,
} from '../../shared/types';

const TOLERANCE = 0.50; // $0.50 rounding tolerance

/**
 * Comprehensive reconciliation engine that compares:
 * 1. Current return vs source documents (income & deduction matching)
 * 2. Current return vs prior year return (missing/changed items)
 * 3. Schedule C/E details vs attributed source docs (P&L, expense reports)
 * 4. Document coverage analysis
 */
export function reconcileDocuments(
  currentReturn: ParsedDocument | null,
  priorReturn: ParsedDocument | null,
  sourceDocuments: ParsedDocument[],
  scheduleAttributions: AttributedDocument[]
): ReconciliationResult {
  const errors: ReviewIssue[] = [];
  const missingItems: ReviewIssue[] = [];
  const discrepancies: ReviewIssue[] = [];
  const priorYearComparison: PriorYearDifference[] = [];
  const scheduleReconciliation: ScheduleReconciliation[] = [];
  const documentCoverage: DocumentCoverage[] = [];

  const currentData = currentReturn?.data;
  const priorData = priorReturn?.data;

  // ─── 1. Compare source documents to current return ───
  if (currentData && sourceDocuments.length > 0) {
    reconcileIncomeToSources(currentData, sourceDocuments, errors, missingItems, discrepancies);
    reconcileDeductionsToSources(currentData, sourceDocuments, errors, missingItems, discrepancies);
  }

  // ─── 2. Compare current return to prior year ───
  if (currentData && priorData) {
    compareToPriorYear(currentData, priorData, priorYearComparison, missingItems);
    // Check for carryover items from prior year
    analyzeCarryovers(currentData, priorData, missingItems);
  }

  // ─── 3. Reconcile Schedules C/E to attributed documents ───
  if (currentData) {
    reconcileSchedules(currentData, sourceDocuments, scheduleAttributions, scheduleReconciliation, errors, discrepancies);
  }

  // ─── 4. Document coverage ───
  analyzeDocumentCoverage(currentData, sourceDocuments, documentCoverage, missingItems);

  // ─── 5. Cross-check totals ───
  if (currentData && sourceDocuments.length > 0) {
    crossCheckTotals(currentData, sourceDocuments, errors, discrepancies);
  }

  const summary = buildSummary(errors, missingItems, discrepancies);

  return {
    errors,
    missingItems,
    discrepancies,
    priorYearComparison,
    scheduleReconciliation,
    documentCoverage,
    summary,
  };
}

// ──────────────────────────────────────────────
// 1. Income reconciliation
// ──────────────────────────────────────────────

function reconcileIncomeToSources(
  currentData: TaxFormData,
  sourceDocuments: ParsedDocument[],
  errors: ReviewIssue[],
  missingItems: ReviewIssue[],
  discrepancies: ReviewIssue[]
): void {
  // Collect all income items from source documents
  const sourceIncomeItems: IncomeItem[] = [];
  for (const doc of sourceDocuments) {
    for (const item of doc.data.incomeItems) {
      sourceIncomeItems.push({ ...item, formSource: `${item.formSource} (${doc.sourceFile.split('/').pop()})` });
    }
  }

  // For each income item on the return, try to find a matching source doc
  for (const returnItem of currentData.incomeItems) {
    const match = findBestIncomeMatch(returnItem, sourceIncomeItems);
    if (match) {
      const diff = Math.abs(returnItem.amount - match.amount);
      if (diff > TOLERANCE) {
        discrepancies.push({
          severity: diff > 100 ? 'error' : 'warning',
          category: 'Income Discrepancy',
          title: `Amount mismatch: ${returnItem.description}`,
          description: `Return shows $${returnItem.amount.toLocaleString()} but source document shows $${match.amount.toLocaleString()}. Difference: $${diff.toLocaleString()}.`,
          amount: diff,
          expectedAmount: match.amount,
          actualAmount: returnItem.amount,
          formReference: returnItem.formSource,
          sourceDocReference: match.formSource,
          recommendation: 'Verify the correct amount from the source document and correct the return if needed.',
        });
      }
      match.matched = true;
      returnItem.matched = true;
    }
  }

  // Source doc items NOT found on the return
  for (const sourceItem of sourceIncomeItems) {
    if (!sourceItem.matched) {
      missingItems.push({
        severity: 'error',
        category: 'Missing Income on Return',
        title: `Source document income not on return: ${sourceItem.description}`,
        description: `Income of $${sourceItem.amount.toLocaleString()} from ${sourceItem.formSource} does not appear on the current tax return. This may need to be reported.`,
        amount: sourceItem.amount,
        sourceDocReference: sourceItem.formSource,
        recommendation: 'Add this income to the tax return or verify it is included elsewhere.',
      });
    }
  }

  // Return items without matching source docs
  for (const returnItem of currentData.incomeItems) {
    if (!returnItem.matched && sourceIncomeItems.length > 0) {
      missingItems.push({
        severity: 'warning',
        category: 'Return Income Without Source',
        title: `Return income has no matching source: ${returnItem.description}`,
        description: `The return reports $${returnItem.amount.toLocaleString()} for "${returnItem.description}" but no matching source document was provided.`,
        amount: returnItem.amount,
        formReference: returnItem.formSource,
        recommendation: 'Upload the corresponding source document or verify this income amount.',
      });
    }
  }
}

function findBestIncomeMatch(target: IncomeItem, candidates: IncomeItem[]): IncomeItem | null {
  let bestMatch: IncomeItem | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (candidate.matched) continue;
    let score = 0;

    // Type match
    if (target.type === candidate.type) score += 3;
    else if (areRelatedTypes(target.type, candidate.type)) score += 1;

    // Amount proximity
    const diff = Math.abs(target.amount - candidate.amount);
    if (diff < TOLERANCE) score += 5;
    else if (diff < 10) score += 3;
    else if (diff < 100) score += 1;
    else if (target.amount > 0 && diff / target.amount > 0.5) score -= 2;

    // Employer/payer match
    if (target.employer && candidate.employer && target.employer.toLowerCase().includes(candidate.employer.toLowerCase())) score += 3;
    if (target.payer && candidate.payer && target.payer.toLowerCase().includes(candidate.payer.toLowerCase())) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

function areRelatedTypes(a: string, b: string): boolean {
  const groups = [
    ['wages', 'w2_wages'],
    ['self_employment', 'business', '1099_NEC', 'k1_ordinary', 'payment_card'],
    ['interest', 'tax_exempt_interest'],
    ['dividends', 'qualified_dividends'],
    ['capital_gains', 'investment_sale'],
    ['rental', 'k1_rental'],
    ['social_security'],
    ['retirement_distribution', 'ira', 'pension'],
    ['gambling'],
  ];
  return groups.some(group => group.includes(a) && group.includes(b));
}

// ──────────────────────────────────────────────
// 2. Deduction reconciliation
// ──────────────────────────────────────────────

function reconcileDeductionsToSources(
  currentData: TaxFormData,
  sourceDocuments: ParsedDocument[],
  errors: ReviewIssue[],
  missingItems: ReviewIssue[],
  discrepancies: ReviewIssue[]
): void {
  const sourceDeductions: DeductionItem[] = [];
  for (const doc of sourceDocuments) {
    for (const item of doc.data.deductionItems) {
      sourceDeductions.push({ ...item, formSource: `${item.formSource} (${doc.sourceFile.split('/').pop()})` });
    }
  }

  // Match return deductions to source deductions
  for (const returnItem of currentData.deductionItems) {
    const match = findBestDeductionMatch(returnItem, sourceDeductions);
    if (match) {
      const diff = Math.abs(returnItem.amount - match.amount);
      if (diff > TOLERANCE) {
        discrepancies.push({
          severity: diff > 100 ? 'error' : 'warning',
          category: 'Deduction Discrepancy',
          title: `Deduction mismatch: ${returnItem.description}`,
          description: `Return shows $${returnItem.amount.toLocaleString()} but source shows $${match.amount.toLocaleString()}. Difference: $${diff.toLocaleString()}.`,
          amount: diff,
          expectedAmount: match.amount,
          actualAmount: returnItem.amount,
          formReference: returnItem.formSource,
          sourceDocReference: match.formSource,
        });
      }
      match.matched = true;
      returnItem.matched = true;
    }
  }

  // Source deductions not reflected on return
  for (const sourceItem of sourceDeductions) {
    if (!sourceItem.matched && sourceItem.amount > 0) {
      missingItems.push({
        severity: 'warning',
        category: 'Potential Missing Deduction',
        title: `Source deduction not on return: ${sourceItem.description}`,
        description: `Deduction of $${sourceItem.amount.toLocaleString()} from source document does not appear on the return.`,
        amount: sourceItem.amount,
        sourceDocReference: sourceItem.formSource,
        recommendation: 'Verify if this deduction should be claimed on the return.',
      });
    }
  }
}

function findBestDeductionMatch(target: DeductionItem, candidates: DeductionItem[]): DeductionItem | null {
  let bestMatch: DeductionItem | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (candidate.matched) continue;
    let score = 0;

    if (target.type === candidate.type) score += 2;
    if (target.category && candidate.category && target.category === candidate.category) score += 3;

    const diff = Math.abs(target.amount - candidate.amount);
    if (diff < TOLERANCE) score += 5;
    else if (diff < 10) score += 3;
    else if (diff < 100) score += 1;

    // Description similarity
    if (target.description && candidate.description) {
      const words1 = target.description.toLowerCase().split(/\s+/);
      const words2 = candidate.description.toLowerCase().split(/\s+/);
      const common = words1.filter(w => words2.includes(w)).length;
      score += common;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

// ──────────────────────────────────────────────
// 3. Prior year comparison
// ──────────────────────────────────────────────

function compareToPriorYear(
  current: TaxFormData,
  prior: TaxFormData,
  differences: PriorYearDifference[],
  missingItems: ReviewIssue[]
): void {
  // Compare by income type
  const currentByType = groupByType(current.incomeItems);
  const priorByType = groupByType(prior.incomeItems);

  const allTypes = new Set([...Object.keys(currentByType), ...Object.keys(priorByType)]);

  for (const type of allTypes) {
    const currentTotal = currentByType[type] || 0;
    const priorTotal = priorByType[type] || 0;

    if (currentTotal === 0 && priorTotal > 0) {
      missingItems.push({
        severity: 'warning',
        category: 'Missing from Prior Year',
        title: `Prior year income type missing: ${formatType(type)}`,
        description: `Prior year had $${priorTotal.toLocaleString()} in ${formatType(type)} income but this year shows $0. Verify this is correct.`,
        amount: priorTotal,
        recommendation: `Check if ${formatType(type)} income should still be reported this year.`,
      });
    }

    const diff = currentTotal - priorTotal;
    const percentChange = priorTotal !== 0 ? (diff / priorTotal) * 100 : (currentTotal > 0 ? 100 : 0);
    const absPct = Math.abs(percentChange);

    differences.push({
      category: formatType(type),
      description: `${formatType(type)} income`,
      priorYearAmount: priorTotal,
      currentYearAmount: currentTotal,
      difference: diff,
      percentChange: Math.round(percentChange * 100) / 100,
      significance: absPct > 50 ? 'high' : absPct > 20 ? 'medium' : 'low',
      note: diff === 0 ? 'No change' : `${diff > 0 ? 'Increased' : 'Decreased'} by ${absPct.toFixed(1)}%`,
    });
  }

  // Check for prior year deduction types missing from current
  const currentDedTypes = new Set(current.deductionItems.map(d => d.type));
  for (const priorDed of prior.deductionItems) {
    if (!currentDedTypes.has(priorDed.type) && priorDed.amount > 100) {
      missingItems.push({
        severity: 'info',
        category: 'Prior Year Deduction Missing',
        title: `Prior year deduction not present: ${priorDed.description}`,
        description: `Prior year claimed $${priorDed.amount.toLocaleString()} for "${priorDed.description}" but this deduction is not on the current return.`,
        recommendation: 'Verify if this deduction still applies.',
      });
    }
  }

  // Check for prior year schedules missing from current
  const currentScheduleTypes = new Set(current.scheduleEntries.map(s => s.scheduleType));
  for (const priorSch of prior.scheduleEntries) {
    if (!currentScheduleTypes.has(priorSch.scheduleType)) {
      missingItems.push({
        severity: 'warning',
        category: 'Prior Year Schedule Missing',
        title: `Schedule ${priorSch.scheduleType} was on prior year return`,
        description: `Prior year included Schedule ${priorSch.scheduleType}${priorSch.businessName ? ' (' + priorSch.businessName + ')' : ''} but it is not present this year.`,
        recommendation: `Verify if Schedule ${priorSch.scheduleType} activity has ceased or was accidentally omitted.`,
      });
    }
  }
}

// ──────────────────────────────────────────────
// 3b. Carryover worksheet analysis
// ──────────────────────────────────────────────

function analyzeCarryovers(
  current: TaxFormData,
  prior: TaxFormData,
  missingItems: ReviewIssue[]
): void {
  // ── 1. Passive Loss Carryover ──
  // If prior year had passive losses (Schedule E with negative net, or explicit passive loss),
  // check that the current year accounts for them.
  const priorPassiveLoss = prior.totals?.passiveLossCarryover || 0;
  const priorRentalEntries = prior.scheduleEntries.filter(s => s.scheduleType === 'E');
  const priorRentalLosses = priorRentalEntries
    .filter(s => (s.netIncome || 0) < 0)
    .reduce((sum, s) => sum + Math.abs(s.netIncome || 0), 0);
  const passiveLossAmount = priorPassiveLoss || priorRentalLosses;

  if (passiveLossAmount > 0) {
    const currentPassiveLoss = current.totals?.passiveLossCarryover || 0;
    const currentHasRentalActivity = current.scheduleEntries.some(s => s.scheduleType === 'E');

    if (currentPassiveLoss === 0 && !currentHasRentalActivity) {
      missingItems.push({
        severity: 'warning',
        category: 'Carryover Missing',
        title: 'Passive loss carryover from prior year not reflected',
        description: `Prior year had $${passiveLossAmount.toLocaleString()} in passive activity losses (suspended/unallowed). These should carry forward to the current year via Form 8582. Verify the passive loss carryover worksheet has been completed.`,
        amount: passiveLossAmount,
        recommendation: 'Review Form 8582 (Passive Activity Loss Limitations) and ensure suspended passive losses from the prior year are properly carried forward.',
      });
    } else if (passiveLossAmount > 0) {
      missingItems.push({
        severity: 'info',
        category: 'Carryover Verification',
        title: 'Passive loss carryover detected from prior year',
        description: `Prior year had $${passiveLossAmount.toLocaleString()} in passive activity losses. Verify the carryover worksheet is complete and amounts are correctly applied to the current year return.`,
        amount: passiveLossAmount,
        recommendation: 'Confirm the passive loss carryover worksheet (Form 8582) correctly carries forward all suspended losses.',
      });
    }
  }

  // ── 2. Estimated Tax Carryover (overpayment applied) ──
  const priorOverpayment = prior.totals?.refund || 0;
  const priorOverpaymentApplied = prior.totals?.priorYearOverpaymentApplied || 0;

  // If the prior year had a refund or overpayment, some may have been applied to current year estimates
  if (priorOverpayment > 0) {
    const currentEstimatedPayments = current.totals?.estimatedTaxPayments || 0;
    const currentOverpaymentApplied = current.totals?.priorYearOverpaymentApplied || 0;

    if (currentOverpaymentApplied === 0 && currentEstimatedPayments === 0) {
      missingItems.push({
        severity: 'info',
        category: 'Carryover Verification',
        title: 'Prior year overpayment - verify estimated tax application',
        description: `Prior year return shows a refund/overpayment of $${priorOverpayment.toLocaleString()}. Verify whether any amount was elected to be applied to current year estimated taxes. If so, it should appear on the current return.`,
        amount: priorOverpayment,
        recommendation: 'Check if the taxpayer elected to apply any of the prior year overpayment to current year estimated taxes (Form 1040 Line 27).',
      });
    }
  }

  // ── 3. Net Operating Loss (NOL) Carryover ──
  const priorNOL = prior.totals?.netOperatingLossDeduction || 0;
  const priorAGI = prior.totals?.adjustedGrossIncome || 0;

  // Check if prior year had an NOL deduction or if AGI was negative (potential NOL)
  if (priorNOL > 0) {
    const currentNOL = current.totals?.netOperatingLossDeduction || 0;
    if (currentNOL === 0) {
      missingItems.push({
        severity: 'warning',
        category: 'Carryover Missing',
        title: 'Net Operating Loss (NOL) carryover from prior year',
        description: `Prior year claimed an NOL deduction of $${priorNOL.toLocaleString()}. If there is remaining NOL to carry forward, ensure it is applied to the current year return.`,
        amount: priorNOL,
        recommendation: 'Review the NOL carryover worksheet and verify the remaining NOL carryforward amount. Post-2017 NOLs are limited to 80% of taxable income.',
      });
    }
  } else if (priorAGI < 0) {
    missingItems.push({
      severity: 'warning',
      category: 'Carryover Verification',
      title: 'Prior year negative AGI may indicate NOL carryforward',
      description: `Prior year had a negative Adjusted Gross Income of $${Math.abs(priorAGI).toLocaleString()}, which may generate a Net Operating Loss. Verify whether an NOL carryforward should be applied to the current year.`,
      amount: Math.abs(priorAGI),
      recommendation: 'Complete the NOL carryover worksheet. Post-2017 NOLs can be carried forward indefinitely but are limited to 80% of taxable income.',
    });
  }

  // ── 4. Capital Gains/Loss Carryover ──
  const priorCapitalLossCarryover = prior.totals?.capitalLossCarryover || 0;
  const priorShortTermCarryover = prior.totals?.shortTermCapitalLossCarryover || 0;
  const priorLongTermCarryover = prior.totals?.longTermCapitalLossCarryover || 0;
  const priorTotalCapitalGains = prior.totals?.totalCapitalGains || 0;

  // If prior year had capital loss carryover explicitly or net capital losses
  if (priorCapitalLossCarryover > 0 || priorShortTermCarryover > 0 || priorLongTermCarryover > 0) {
    const totalCarryover = priorCapitalLossCarryover || (priorShortTermCarryover + priorLongTermCarryover);
    const currentCapitalLossCarryover = current.totals?.capitalLossCarryover || 0;

    if (currentCapitalLossCarryover === 0) {
      missingItems.push({
        severity: 'warning',
        category: 'Carryover Missing',
        title: 'Capital loss carryover from prior year not reflected',
        description: `Prior year had capital loss carryover of $${totalCarryover.toLocaleString()}${priorShortTermCarryover ? ` (ST: $${priorShortTermCarryover.toLocaleString()})` : ''}${priorLongTermCarryover ? ` (LT: $${priorLongTermCarryover.toLocaleString()})` : ''}. This should be entered on the current year Schedule D.`,
        amount: totalCarryover,
        recommendation: 'Complete the Capital Loss Carryover Worksheet from Schedule D instructions. Enter short-term carryover on Schedule D Line 6 and long-term carryover on Line 14.',
      });
    }
  } else if (priorTotalCapitalGains < -3000) {
    // If prior year had capital losses beyond the $3,000 deduction limit, there should be a carryover
    const excessLoss = Math.abs(priorTotalCapitalGains) - 3000;
    if (excessLoss > 0) {
      const currentCapitalLossCarryover = current.totals?.capitalLossCarryover || 0;
      const currentShortTermCarryover = current.totals?.shortTermCapitalLossCarryover || 0;
      const currentLongTermCarryover = current.totals?.longTermCapitalLossCarryover || 0;

      if (currentCapitalLossCarryover === 0 && currentShortTermCarryover === 0 && currentLongTermCarryover === 0) {
        missingItems.push({
          severity: 'warning',
          category: 'Carryover Missing',
          title: 'Capital loss carryforward likely missing',
          description: `Prior year had net capital losses of $${Math.abs(priorTotalCapitalGains).toLocaleString()}, exceeding the $3,000 annual deduction limit. Approximately $${excessLoss.toLocaleString()} should carry forward to the current year Schedule D.`,
          amount: excessLoss,
          recommendation: 'Complete the Capital Loss Carryover Worksheet. The excess capital loss beyond the $3,000 annual limit carries forward to the next tax year.',
        });
      }
    }
  }

  // ── 5. Check for prior year Schedule C/E that might have carryover implications ──
  const priorScheduleC = prior.scheduleEntries.filter(s => s.scheduleType === 'C');
  for (const priorBiz of priorScheduleC) {
    const netLoss = priorBiz.netIncome || 0;
    if (netLoss < -5000) {
      // Significant business loss - may have passive loss or NOL implications
      const currentHasSameBiz = current.scheduleEntries.some(
        s => s.scheduleType === 'C' && s.businessName === priorBiz.businessName
      );
      if (!currentHasSameBiz) {
        missingItems.push({
          severity: 'info',
          category: 'Carryover Verification',
          title: `Prior year Schedule C business "${priorBiz.businessName || 'unnamed'}" had significant loss`,
          description: `Prior year Schedule C for "${priorBiz.businessName || 'unnamed business'}" showed a net loss of $${Math.abs(netLoss).toLocaleString()}. If the business ceased, verify any remaining carryovers (NOL, depreciation recapture, etc.) are properly handled.`,
          amount: Math.abs(netLoss),
          recommendation: 'Verify if any NOL or other carryovers from this business activity need to be carried forward.',
        });
      }
    }
  }
}

function groupByType(items: IncomeItem[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    result[item.type] = (result[item.type] || 0) + item.amount;
  }
  return result;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ──────────────────────────────────────────────
// 4. Schedule reconciliation
// ──────────────────────────────────────────────

function reconcileSchedules(
  currentData: TaxFormData,
  sourceDocuments: ParsedDocument[],
  attributions: AttributedDocument[],
  results: ScheduleReconciliation[],
  errors: ReviewIssue[],
  discrepancies: ReviewIssue[]
): void {
  for (let i = 0; i < currentData.scheduleEntries.length; i++) {
    const schedule = currentData.scheduleEntries[i];

    // Find attributed source docs for this schedule
    const attributedDocs = attributions.filter(a => a.scheduleType === schedule.scheduleType && a.scheduleIndex === i);
    const attributedSourceDocs = sourceDocuments.filter(sd =>
      attributedDocs.some(a => a.filePath === sd.sourceFile)
    );

    // Aggregate source doc totals
    let sourceGrossIncome = 0;
    let sourceTotalExpenses = 0;
    const sourceExpensesByCategory: Record<string, number> = {};

    for (const doc of attributedSourceDocs) {
      sourceGrossIncome += doc.data.incomeItems.reduce((s, i) => s + i.amount, 0);
      for (const ded of doc.data.deductionItems) {
        const cat = ded.category || 'Other';
        sourceExpensesByCategory[cat] = (sourceExpensesByCategory[cat] || 0) + ded.amount;
        sourceTotalExpenses += ded.amount;
      }
    }

    // Build line-item matches
    const lineItemMatches: ScheduleReconciliation['lineItemMatches'] = [];
    const allCategories = new Set([
      ...Object.keys(schedule.expenses),
      ...Object.keys(sourceExpensesByCategory),
    ]);

    for (const category of allCategories) {
      const returnAmount = schedule.expenses[category] || 0;
      const sourceAmount = sourceExpensesByCategory[category] || 0;
      const diff = returnAmount - sourceAmount;
      lineItemMatches.push({
        category,
        returnAmount,
        sourceAmount,
        difference: diff,
        matched: Math.abs(diff) <= TOLERANCE,
      });

      if (Math.abs(diff) > TOLERANCE && (returnAmount > 0 || sourceAmount > 0)) {
        discrepancies.push({
          severity: Math.abs(diff) > 500 ? 'error' : 'warning',
          category: `Schedule ${schedule.scheduleType} Expense`,
          title: `${category} expense mismatch`,
          description: `Schedule ${schedule.scheduleType}${schedule.businessName ? ' (' + schedule.businessName + ')' : ''}: Return shows $${returnAmount.toLocaleString()} for ${category} but source docs total $${sourceAmount.toLocaleString()}.`,
          amount: Math.abs(diff),
          expectedAmount: sourceAmount,
          actualAmount: returnAmount,
        });
      }
    }

    const returnAmount = schedule.grossIncome || 0;
    const diff = returnAmount - sourceGrossIncome;

    results.push({
      scheduleType: schedule.scheduleType,
      scheduleIndex: i,
      businessName: schedule.businessName,
      returnAmount,
      sourceDocTotal: sourceGrossIncome,
      difference: diff,
      lineItemMatches,
    });

    if (attributedSourceDocs.length > 0 && Math.abs(diff) > TOLERANCE) {
      errors.push({
        severity: Math.abs(diff) > 1000 ? 'error' : 'warning',
        category: `Schedule ${schedule.scheduleType} Income`,
        title: `Gross income mismatch on Schedule ${schedule.scheduleType}`,
        description: `Return shows $${returnAmount.toLocaleString()} but attributed source documents total $${sourceGrossIncome.toLocaleString()}. Difference: $${Math.abs(diff).toLocaleString()}.`,
        amount: Math.abs(diff),
        expectedAmount: sourceGrossIncome,
        actualAmount: returnAmount,
      });
    }
  }
}

// ──────────────────────────────────────────────
// 5. Document coverage
// ──────────────────────────────────────────────

function analyzeDocumentCoverage(
  currentData: TaxFormData | undefined,
  sourceDocuments: ParsedDocument[],
  coverage: DocumentCoverage[],
  missingItems: ReviewIssue[]
): void {
  for (const doc of sourceDocuments) {
    const fileName = doc.sourceFile.split('/').pop() || doc.sourceFile;
    const docType = doc.formType;
    let covered = false;
    let matchedItem = '';

    if (currentData) {
      // Check if any income item from this doc matches a return item
      for (const sourceIncome of doc.data.incomeItems) {
        for (const returnIncome of currentData.incomeItems) {
          if (sourceIncome.type === returnIncome.type && Math.abs(sourceIncome.amount - returnIncome.amount) < 100) {
            covered = true;
            matchedItem = returnIncome.description;
            break;
          }
        }
        if (covered) break;
      }

      // Check deductions too
      if (!covered) {
        for (const sourceDed of doc.data.deductionItems) {
          for (const returnDed of currentData.deductionItems) {
            if (sourceDed.type === returnDed.type && Math.abs(sourceDed.amount - returnDed.amount) < 100) {
              covered = true;
              matchedItem = returnDed.description;
              break;
            }
          }
          if (covered) break;
        }
      }
    }

    coverage.push({
      documentName: fileName,
      documentType: docType,
      covered,
      matchedReturnItem: matchedItem || undefined,
      notes: covered ? 'Matched to return' : 'No matching item found on return',
    });

    if (!covered && doc.data.incomeItems.length > 0) {
      const totalIncome = doc.data.incomeItems.reduce((s, i) => s + i.amount, 0);
      if (totalIncome > 0) {
        missingItems.push({
          severity: 'warning',
          category: 'Uncovered Document',
          title: `Document not reflected on return: ${fileName}`,
          description: `${docType} showing $${totalIncome.toLocaleString()} in income does not appear to be reflected on the current return.`,
          amount: totalIncome,
          recommendation: 'Verify this document\'s income is properly reported.',
        });
      }
    }
  }
}

// ──────────────────────────────────────────────
// 6. Total cross-checks
// ──────────────────────────────────────────────

function crossCheckTotals(
  currentData: TaxFormData,
  sourceDocuments: ParsedDocument[],
  errors: ReviewIssue[],
  discrepancies: ReviewIssue[]
): void {
  // W-2 wage total cross-check
  const w2Docs = sourceDocuments.filter(d => d.formType === 'W2');
  if (w2Docs.length > 0) {
    const w2Total = w2Docs.reduce((sum, doc) =>
      sum + doc.data.incomeItems.filter(i => i.type === 'wages').reduce((s, i) => s + i.amount, 0), 0);

    const returnWages = currentData.incomeItems.filter(i => i.type === 'wages').reduce((s, i) => s + i.amount, 0);

    if (Math.abs(w2Total - returnWages) > TOLERANCE && w2Total > 0) {
      discrepancies.push({
        severity: 'error',
        category: 'Wage Total Mismatch',
        title: 'W-2 wage total does not match return',
        description: `Total W-2 wages: $${w2Total.toLocaleString()}. Return wages (Line 1): $${returnWages.toLocaleString()}. Difference: $${Math.abs(w2Total - returnWages).toLocaleString()}.`,
        amount: Math.abs(w2Total - returnWages),
        expectedAmount: w2Total,
        actualAmount: returnWages,
        recommendation: 'Ensure all W-2s are properly entered and totals match.',
      });
    }
  }

  // Federal withholding cross-check
  const totalSourceWithholding = sourceDocuments.reduce((sum, doc) =>
    sum + (doc.data.totals?.federalWithheld || 0) + (doc.data.totals?.w2FederalWithheld || 0), 0);

  if (totalSourceWithholding > 0 && currentData.totals?.totalPayments) {
    // Note: totalPayments includes more than just withholding, so this is approximate
    if (totalSourceWithholding > currentData.totals.totalPayments + 100) {
      discrepancies.push({
        severity: 'warning',
        category: 'Withholding Discrepancy',
        title: 'Source document withholding exceeds return payments',
        description: `Source documents show $${totalSourceWithholding.toLocaleString()} in federal withholding but return total payments is $${currentData.totals.totalPayments.toLocaleString()}.`,
        amount: totalSourceWithholding - currentData.totals.totalPayments,
        recommendation: 'Verify all withholding is properly credited on the return.',
      });
    }
  }
}

// ──────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────

function buildSummary(
  errors: ReviewIssue[],
  missingItems: ReviewIssue[],
  discrepancies: ReviewIssue[]
): ReconciliationSummary {
  const totalErrors = errors.filter(e => e.severity === 'error').length
    + missingItems.filter(e => e.severity === 'error').length
    + discrepancies.filter(e => e.severity === 'error').length;

  const totalWarnings = errors.filter(e => e.severity === 'warning').length
    + missingItems.filter(e => e.severity === 'warning').length
    + discrepancies.filter(e => e.severity === 'warning').length;

  const incomeErrors = [...errors, ...discrepancies].filter(e =>
    e.category.toLowerCase().includes('income') || e.category.toLowerCase().includes('wage'));
  const deductionErrors = [...errors, ...discrepancies].filter(e =>
    e.category.toLowerCase().includes('deduction') || e.category.toLowerCase().includes('expense'));

  let overallStatus: 'pass' | 'review_needed' | 'issues_found' = 'pass';
  if (totalErrors > 0) overallStatus = 'issues_found';
  else if (totalWarnings > 0 || missingItems.length > 0) overallStatus = 'review_needed';

  return {
    totalErrors,
    totalWarnings,
    totalMissing: missingItems.length,
    totalDiscrepancies: discrepancies.length,
    incomeFullyReconciled: incomeErrors.length === 0,
    deductionsFullyReconciled: deductionErrors.length === 0,
    overallStatus,
  };
}
