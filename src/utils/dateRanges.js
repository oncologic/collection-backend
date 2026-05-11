const normalizeDateValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  return normalized.split('T')[0];
};

export const buildDateRangeCreateFields = (payload = {}) => {
  const startDate = normalizeDateValue(
    payload.startDate ?? payload.start_date ?? payload.date
  );
  const endDate = normalizeDateValue(payload.endDate ?? payload.end_date);

  return {
    startDate,
    endDate: endDate ?? startDate,
    date: startDate,
  };
};

export const buildDateRangeUpdateFields = (payload = {}) => {
  const hasStartDate =
    Object.prototype.hasOwnProperty.call(payload, 'startDate') ||
    Object.prototype.hasOwnProperty.call(payload, 'start_date') ||
    Object.prototype.hasOwnProperty.call(payload, 'date');
  const hasEndDate =
    Object.prototype.hasOwnProperty.call(payload, 'endDate') ||
    Object.prototype.hasOwnProperty.call(payload, 'end_date');

  if (!hasStartDate && !hasEndDate) {
    return {};
  }

  const startDate = hasStartDate
    ? normalizeDateValue(payload.startDate ?? payload.start_date ?? payload.date)
    : undefined;
  const explicitEndDate = hasEndDate
    ? normalizeDateValue(payload.endDate ?? payload.end_date)
    : undefined;

  const resolvedStartDate =
    startDate !== undefined ? startDate : explicitEndDate ?? null;
  const resolvedEndDate =
    explicitEndDate !== undefined
      ? explicitEndDate
      : resolvedStartDate !== undefined
      ? resolvedStartDate
      : null;

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    date: resolvedStartDate,
  };
};
