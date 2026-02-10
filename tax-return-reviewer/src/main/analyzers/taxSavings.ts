import { ParsedDocument, TaxFormData, TaxSavingsSuggestion } from '../../shared/types';

/**
 * Analyzes the current return and source documents to identify
 * potentially missed tax savings opportunities.
 */
export function findTaxSavings(
  currentReturn: ParsedDocument | null,
  sourceDocuments: ParsedDocument[]
): TaxSavingsSuggestion[] {
  const suggestions: TaxSavingsSuggestion[] = [];
  const data = currentReturn?.data;
  if (!data) return suggestions;

  const agi = data.totals?.adjustedGrossIncome || data.incomeItems.reduce((s, i) => s + i.amount, 0);
  const hasBusinessIncome = data.incomeItems.some(i => ['business', 'self_employment', 'k1_ordinary'].includes(i.type));
  const hasRentalIncome = data.incomeItems.some(i => ['rental', 'k1_rental'].includes(i.type));
  const hasWages = data.incomeItems.some(i => i.type === 'wages');
  const scheduleCs = data.scheduleEntries.filter(s => s.scheduleType === 'C');
  const scheduleEs = data.scheduleEntries.filter(s => s.scheduleType === 'E');
  const deductionTypes = new Set(data.deductionItems.map(d => d.type));
  const incomeTypes = new Set(data.incomeItems.map(i => i.type));

  // ─── Retirement Contributions ───
  checkRetirementContributions(data, agi, hasBusinessIncome, hasWages, deductionTypes, suggestions);

  // ─── HSA Contributions ───
  checkHSA(data, deductionTypes, suggestions);

  // ─── Business Deductions ───
  if (hasBusinessIncome) {
    checkBusinessDeductions(data, scheduleCs, sourceDocuments, suggestions);
  }

  // ─── Rental Property Deductions ───
  if (hasRentalIncome) {
    checkRentalDeductions(data, scheduleEs, suggestions);
  }

  // ─── Itemized vs Standard Deduction ───
  checkItemizedVsStandard(data, suggestions);

  // ─── Education Credits ───
  checkEducationCredits(data, deductionTypes, suggestions);

  // ─── Estimated Tax Payments ───
  if (hasBusinessIncome || hasRentalIncome) {
    checkEstimatedTaxPayments(data, suggestions);
  }

  // ─── QBI Deduction (Section 199A) ───
  checkQBIDeduction(data, hasBusinessIncome, hasRentalIncome, suggestions);

  // ─── Child/Dependent Credits ───
  checkDependentCredits(data, suggestions);

  // ─── Energy Credits ───
  checkEnergyCredits(data, deductionTypes, suggestions);

  // ─── Charitable Contributions ───
  checkCharitable(data, deductionTypes, suggestions);

  // ─── Capital Loss Harvesting ───
  checkCapitalLosses(data, incomeTypes, suggestions);

  // ─── Student Loan Interest ───
  checkStudentLoan(data, deductionTypes, agi, suggestions);

  // ─── Health Insurance Premium Deduction ───
  if (hasBusinessIncome) {
    checkSEHealthInsurance(data, deductionTypes, suggestions);
  }

  return suggestions;
}

function checkRetirementContributions(
  data: TaxFormData, agi: number, hasBusiness: boolean, hasWages: boolean,
  deductions: Set<string>, suggestions: TaxSavingsSuggestion[]
): void {
  const hasIRAContribution = deductions.has('ira_contribution');
  const has401k = data.rawLineItems.some(i => i.label.toLowerCase().includes('401') || i.label.toLowerCase().includes('retirement'));

  if (!hasIRAContribution) {
    suggestions.push({
      id: 'ira_contribution',
      category: 'Retirement',
      title: 'Traditional/Roth IRA Contribution',
      description: 'No IRA contribution detected. Contributing up to $7,000 ($8,000 if age 50+) to a Traditional IRA may be tax-deductible, or a Roth IRA provides tax-free growth. Contributions can be made until the tax filing deadline.',
      estimatedSavings: Math.min(7000, agi) * 0.22,
      applicability: 'likely',
      irsReference: 'Publication 590-A',
      requirements: ['Must have earned income', 'Traditional IRA deduction phases out at higher AGI if covered by employer plan'],
    });
  }

  if (hasBusiness) {
    suggestions.push({
      id: 'sep_ira',
      category: 'Retirement',
      title: 'SEP-IRA or Solo 401(k) Contribution',
      description: 'Self-employment income detected. A SEP-IRA allows contributions up to 25% of net self-employment income (max $69,000). A Solo 401(k) allows even higher contributions with an employee deferral component.',
      estimatedSavings: undefined,
      applicability: 'likely',
      irsReference: 'Publication 560',
      requirements: ['Must have self-employment income', 'SEP-IRA deadline is tax filing deadline including extensions'],
    });
  }
}

function checkHSA(data: TaxFormData, deductions: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const hasHSA = deductions.has('hsa_contribution') || data.rawLineItems.some(i => i.label.toLowerCase().includes('hsa'));

  if (!hasHSA) {
    suggestions.push({
      id: 'hsa_contribution',
      category: 'Health Savings',
      title: 'Health Savings Account (HSA) Contribution',
      description: 'No HSA contribution detected. If enrolled in a High Deductible Health Plan, you can contribute up to $4,150 (individual) or $8,300 (family) tax-deductible, with tax-free growth and withdrawals for medical expenses.',
      estimatedSavings: 4150 * 0.22,
      applicability: 'possible',
      irsReference: 'Publication 969',
      requirements: ['Must be enrolled in a High Deductible Health Plan (HDHP)', 'Cannot be enrolled in Medicare'],
    });
  }
}

function checkBusinessDeductions(
  data: TaxFormData, scheduleCs: any[], sourceDocuments: ParsedDocument[],
  suggestions: TaxSavingsSuggestion[]
): void {
  for (const schC of scheduleCs) {
    const expenses = schC.expenses || {};

    if (!expenses['Car and truck'] && !expenses['Travel']) {
      suggestions.push({
        id: 'vehicle_deduction',
        category: 'Business Expenses',
        title: 'Vehicle/Mileage Deduction',
        description: `No vehicle expenses on Schedule C${schC.businessName ? ' (' + schC.businessName + ')' : ''}. If you use a vehicle for business, you may deduct actual expenses or the standard mileage rate ($0.67/mile for 2024).`,
        applicability: 'possible',
        irsReference: 'Publication 463',
        requirements: ['Must track mileage or actual expenses', 'Must have business use of vehicle'],
      });
    }

    if (!expenses['Office expense'] && !expenses['Rent or lease']) {
      suggestions.push({
        id: 'home_office',
        category: 'Business Expenses',
        title: 'Home Office Deduction',
        description: `No home office deduction claimed on Schedule C${schC.businessName ? ' (' + schC.businessName + ')' : ''}. If you use part of your home exclusively for business, you can deduct $5/sq ft (up to 300 sq ft = $1,500) using the simplified method, or actual expenses.`,
        estimatedSavings: 1500,
        applicability: 'possible',
        irsReference: 'Publication 587',
        requirements: ['Must use space regularly and exclusively for business', 'Must be principal place of business'],
      });
    }

    if (!expenses['Depreciation']) {
      suggestions.push({
        id: 'depreciation',
        category: 'Business Expenses',
        title: 'Depreciation / Section 179 Deduction',
        description: 'No depreciation claimed. Business equipment, furniture, computers, and other assets may be depreciated or fully expensed under Section 179 (up to $1,220,000) or bonus depreciation.',
        applicability: 'possible',
        irsReference: 'Publication 946',
        requirements: ['Must have business assets placed in service during the tax year'],
      });
    }

    if (!expenses['Insurance']) {
      suggestions.push({
        id: 'business_insurance',
        category: 'Business Expenses',
        title: 'Business Insurance Deduction',
        description: 'No insurance expense on Schedule C. Business insurance premiums (liability, E&O, property, cyber) are deductible business expenses.',
        applicability: 'possible',
        irsReference: 'Publication 535',
      });
    }

    // Check if P&L has items not on Schedule C
    const plDocs = sourceDocuments.filter(d => d.formType === 'PROFIT_LOSS' || d.formType === 'EXPENSE_REPORT');
    for (const plDoc of plDocs) {
      for (const ded of plDoc.data.deductionItems) {
        const category = ded.category || '';
        if (category && !expenses[category]) {
          suggestions.push({
            id: `missing_expense_${category.toLowerCase().replace(/\s+/g, '_')}`,
            category: 'Business Expenses',
            title: `P&L expense not on Schedule C: ${category}`,
            description: `Your P&L shows $${ded.amount.toLocaleString()} in ${category} expenses but this category does not appear on Schedule C. This may be a missed deduction.`,
            estimatedSavings: ded.amount * 0.22,
            applicability: 'likely',
          });
        }
      }
    }
  }
}

function checkRentalDeductions(data: TaxFormData, scheduleEs: any[], suggestions: TaxSavingsSuggestion[]): void {
  for (const schE of scheduleEs) {
    const expenses = schE.expenses || {};

    if (!expenses['Depreciation']) {
      suggestions.push({
        id: 'rental_depreciation',
        category: 'Rental Property',
        title: 'Rental Property Depreciation',
        description: 'No depreciation on Schedule E. Residential rental property must be depreciated over 27.5 years. This is a non-cash deduction that reduces taxable rental income.',
        applicability: 'likely',
        irsReference: 'Publication 527',
        requirements: ['Must own the rental property', 'Depreciation begins when property is placed in service'],
      });
    }

    if (!expenses['Repairs'] && !expenses['Cleaning and maintenance']) {
      suggestions.push({
        id: 'rental_repairs',
        category: 'Rental Property',
        title: 'Rental Repairs and Maintenance',
        description: 'No repair/maintenance expenses on Schedule E. Routine repairs, cleaning between tenants, and maintenance are fully deductible in the year incurred.',
        applicability: 'possible',
        irsReference: 'Publication 527',
      });
    }
  }
}

function checkItemizedVsStandard(data: TaxFormData, suggestions: TaxSavingsSuggestion[]): void {
  const standardDeduction = data.deductionItems.find(d => d.type === 'standard_deduction');
  const totalItemized = data.totals?.totalItemizedDeductions;

  if (standardDeduction && !totalItemized) {
    // Using standard deduction - check if itemizing might be better
    const mortgageInterest = data.deductionItems.filter(d => d.type === 'mortgage_interest').reduce((s, d) => s + d.amount, 0);
    const salt = data.deductionItems.filter(d => d.type === 'salt' || d.type === 'property_tax').reduce((s, d) => s + d.amount, 0);
    const charitable = data.deductionItems.filter(d => d.type === 'charitable').reduce((s, d) => s + d.amount, 0);
    const medical = data.deductionItems.filter(d => d.type === 'medical').reduce((s, d) => s + d.amount, 0);

    const potentialItemized = mortgageInterest + Math.min(salt, 10000) + charitable + medical;
    if (potentialItemized > standardDeduction.amount * 0.8) {
      suggestions.push({
        id: 'itemize_review',
        category: 'Deductions',
        title: 'Review Itemized vs Standard Deduction',
        description: `Currently using standard deduction of $${standardDeduction.amount.toLocaleString()}. Potential itemized deductions total approximately $${potentialItemized.toLocaleString()}. Consider whether itemizing or bunching deductions across years could be beneficial.`,
        applicability: 'investigate',
        irsReference: 'Schedule A instructions',
      });
    }
  }
}

function checkEducationCredits(data: TaxFormData, deductions: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const has1098T = data.deductionItems.some(d => d.type === 'education');
  const hasEducationCredit = data.rawLineItems.some(i =>
    i.label.toLowerCase().includes('education') || i.label.toLowerCase().includes('american opportunity') || i.label.toLowerCase().includes('lifetime learning'));

  if (has1098T && !hasEducationCredit) {
    suggestions.push({
      id: 'education_credit',
      category: 'Credits',
      title: 'Education Tax Credit',
      description: 'Tuition payments detected (1098-T) but no education credit on return. The American Opportunity Credit provides up to $2,500 per student (first 4 years of college), and the Lifetime Learning Credit provides up to $2,000.',
      estimatedSavings: 2500,
      applicability: 'likely',
      irsReference: 'Form 8863',
      requirements: ['Student must be enrolled at eligible institution', 'AGI limitations apply'],
    });
  }
}

function checkEstimatedTaxPayments(data: TaxFormData, suggestions: TaxSavingsSuggestion[]): void {
  const amountOwed = data.totals?.amountOwed;
  if (amountOwed && amountOwed > 1000) {
    suggestions.push({
      id: 'estimated_payments',
      category: 'Tax Planning',
      title: 'Estimated Tax Payment Strategy',
      description: `Amount owed is $${amountOwed.toLocaleString()}, which may trigger an underpayment penalty. Consider making quarterly estimated tax payments (Form 1040-ES) to avoid penalties next year. The safe harbor is 100% of prior year tax (110% if AGI > $150,000).`,
      applicability: 'likely',
      irsReference: 'Form 2210, Publication 505',
    });
  }
}

function checkQBIDeduction(data: TaxFormData, hasBusiness: boolean, hasRental: boolean, suggestions: TaxSavingsSuggestion[]): void {
  if ((hasBusiness || hasRental) && !data.totals?.section199A) {
    const hasQBI = data.rawLineItems.some(i => i.label.toLowerCase().includes('199a') || i.label.toLowerCase().includes('qualified business'));
    if (!hasQBI) {
      suggestions.push({
        id: 'qbi_deduction',
        category: 'Deductions',
        title: 'Qualified Business Income (QBI) Deduction',
        description: 'Business/rental income detected but no Section 199A QBI deduction found. This deduction allows up to 20% of qualified business income to be deducted, potentially saving significant taxes.',
        applicability: 'likely',
        irsReference: 'Form 8995 or 8995-A',
        requirements: ['Must have qualified business income', 'Income limitations may apply for specified service businesses'],
      });
    }
  }
}

function checkDependentCredits(data: TaxFormData, suggestions: TaxSavingsSuggestion[]): void {
  const hasChildCredit = data.rawLineItems.some(i => i.label.toLowerCase().includes('child') && i.label.toLowerCase().includes('credit'));
  const hasDependentCare = data.rawLineItems.some(i => i.label.toLowerCase().includes('dependent care') || i.label.toLowerCase().includes('child care') || i.label.toLowerCase().includes('2441'));
  const hasEITC = data.rawLineItems.some(i => i.label.toLowerCase().includes('earned income') && i.label.toLowerCase().includes('credit'));

  if (!hasDependentCare) {
    suggestions.push({
      id: 'dependent_care',
      category: 'Credits',
      title: 'Child and Dependent Care Credit',
      description: 'No child/dependent care credit detected. If you paid for childcare or dependent care to work or look for work, you may be eligible for a credit of 20-35% of up to $3,000 ($6,000 for 2+ dependents) in care expenses.',
      applicability: 'possible',
      irsReference: 'Form 2441',
      requirements: ['Must have paid care expenses to work or look for work', 'Care recipient must be under 13 or disabled dependent'],
    });
  }

  const agi = data.totals?.adjustedGrossIncome || 0;
  if (!hasEITC && agi < 63398) {
    suggestions.push({
      id: 'eitc',
      category: 'Credits',
      title: 'Earned Income Tax Credit (EITC)',
      description: 'No EITC detected. Based on the AGI, you may qualify for the Earned Income Tax Credit, worth up to $7,430 with 3+ children. This is a refundable credit.',
      applicability: 'investigate',
      irsReference: 'Publication 596, Schedule EIC',
      requirements: ['Must have earned income', 'AGI limits apply based on filing status and number of children', 'Investment income must be $11,000 or less'],
    });
  }
}

function checkEnergyCredits(data: TaxFormData, deductions: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const hasEnergyCredit = data.rawLineItems.some(i =>
    i.label.toLowerCase().includes('energy') || i.label.toLowerCase().includes('solar') ||
    i.label.toLowerCase().includes('5695') || i.label.toLowerCase().includes('electric vehicle'));

  if (!hasEnergyCredit) {
    suggestions.push({
      id: 'energy_credits',
      category: 'Credits',
      title: 'Residential Energy Credits',
      description: 'No energy credits detected. If you made qualifying energy improvements (solar panels, heat pumps, insulation, energy-efficient windows, etc.), you may claim up to 30% of costs. Electric vehicle purchases may qualify for up to $7,500 credit.',
      applicability: 'possible',
      irsReference: 'Form 5695, Form 8936',
    });
  }
}

function checkCharitable(data: TaxFormData, deductions: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const hasCharitable = deductions.has('charitable');
  if (!hasCharitable) {
    suggestions.push({
      id: 'charitable_giving',
      category: 'Deductions',
      title: 'Charitable Contribution Strategy',
      description: 'No charitable contributions detected. If you made donations to qualified organizations (cash, goods, or appreciated stock), these may be deductible if itemizing. Even with standard deduction, consider donor-advised funds to bunch contributions.',
      applicability: 'possible',
      irsReference: 'Publication 526',
    });
  }
}

function checkCapitalLosses(data: TaxFormData, incomeTypes: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const hasCapitalGains = incomeTypes.has('capital_gains') || incomeTypes.has('investment_sale');
  if (hasCapitalGains) {
    suggestions.push({
      id: 'tax_loss_harvesting',
      category: 'Investment Strategy',
      title: 'Tax-Loss Harvesting Review',
      description: 'Capital gains detected. Review portfolio for unrealized losses that could offset gains. Up to $3,000 of net capital losses can be deducted against ordinary income, with excess carried forward.',
      applicability: 'investigate',
      irsReference: 'Schedule D, Publication 550',
    });
  }
}

function checkStudentLoan(data: TaxFormData, deductions: Set<string>, agi: number, suggestions: TaxSavingsSuggestion[]): void {
  const hasStudentLoan = deductions.has('student_loan_interest');
  const has1098E = data.deductionItems.some(d => d.type === 'student_loan_interest');

  if (has1098E && !hasStudentLoan && agi < 90000) {
    suggestions.push({
      id: 'student_loan_interest',
      category: 'Deductions',
      title: 'Student Loan Interest Deduction',
      description: 'Student loan interest (1098-E) detected but deduction not found on return. Up to $2,500 of student loan interest is deductible as an above-the-line deduction.',
      estimatedSavings: 2500 * 0.22,
      applicability: 'likely',
      irsReference: 'Publication 970',
      requirements: ['AGI must be below $90,000 (single) or $185,000 (MFJ)', 'Loan must be qualified education loan'],
    });
  }
}

function checkSEHealthInsurance(data: TaxFormData, deductions: Set<string>, suggestions: TaxSavingsSuggestion[]): void {
  const hasSEHealth = data.rawLineItems.some(i => i.label.toLowerCase().includes('self-employed health') || i.label.toLowerCase().includes('se health'));
  if (!hasSEHealth) {
    suggestions.push({
      id: 'se_health_insurance',
      category: 'Deductions',
      title: 'Self-Employed Health Insurance Deduction',
      description: 'Self-employment income detected but no self-employed health insurance deduction found. If you paid for your own health insurance and were not eligible for employer coverage, you can deduct 100% of premiums as an above-the-line deduction.',
      applicability: 'likely',
      irsReference: 'Publication 535, Form 1040 Schedule 1',
      requirements: ['Must not be eligible for employer-sponsored health coverage', 'Deduction limited to net self-employment income'],
    });
  }
}
