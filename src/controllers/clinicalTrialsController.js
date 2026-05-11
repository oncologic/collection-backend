/**
 * Helper function to strip HTML mark tags from text
 * @param {string} text - Text that may contain HTML mark tags
 * @returns {string} - Clean text without mark tags
 */
const stripMarkTags = (text) => {
  if (!text) return '';

  // Replace all mark tags with their contents
  return text.replace(/<mark[^>]*>|<\/mark>/g, '');
};

/**
 * Helper function to clean and prepare a trial for display
 * @param {Object} hit - The trial hit from clinicaltrials.gov
 * @returns {Object} - Cleaned trial data
 */
const cleanTrialData = (hit) => {
  const study = hit.study || {};
  const protocolSection = study.protocolSection || {};
  const identificationModule = protocolSection.identificationModule || {};
  const statusModule = protocolSection.statusModule || {};
  const conditionsModule = protocolSection.conditionsModule || {};
  const designModule = protocolSection.designModule || {};
  const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
  const contactsLocationsModule = protocolSection.contactsLocationsModule || {};
  const descriptionModule = protocolSection.descriptionModule || {};
  const eligibilityModule = protocolSection.eligibilityModule || {};

  // Format data to match the frontend TrialCard component expectations
  // Strip HTML mark tags from all text fields
  return {
    NCTId: [identificationModule.nctId || ''],
    BriefTitle: [
      stripMarkTags(identificationModule.briefTitle || 'Untitled Trial'),
    ],
    OverallStatus: [
      statusModule.overallStatus === 'UNKNOWN'
        ? statusModule.lastKnownStatus
        : statusModule.overallStatus,
    ],
    Phase: designModule.phases ? [designModule.phases.join(', ')] : ['N/A'],
    StartDate: [statusModule.startDateStruct?.date || ''],
    Condition: (conditionsModule.conditions || []).map((cond) =>
      stripMarkTags(cond)
    ),
    InterventionName: armsInterventionsModule.interventions
      ? armsInterventionsModule.interventions.map((i) => stripMarkTags(i.name))
      : [],
    LocationCountry: contactsLocationsModule.locations
      ? contactsLocationsModule.locations.map((l) => l.country)
      : [],
    LocationState: contactsLocationsModule.locations
      ? contactsLocationsModule.locations.map((l) => l.state || '')
      : [],
    LocationCity: contactsLocationsModule.locations
      ? contactsLocationsModule.locations.map((l) => l.city || '')
      : [],
    LocationFacility: contactsLocationsModule.locations
      ? contactsLocationsModule.locations.map((l) =>
          stripMarkTags(l.facility || '')
        )
      : [],
    BriefSummary: [stripMarkTags(descriptionModule.briefSummary || '')],
    whyStopped: statusModule.whyStopped
      ? stripMarkTags(statusModule.whyStopped)
      : null,
    // Additional fields that might help the frontend
    PrimaryCompletionDate: [
      statusModule.primaryCompletionDateStruct?.date || '',
    ],
    CompletionDate: [statusModule.completionDateStruct?.date || ''],
    StudyType: [designModule.studyType || ''],
    hasResults: statusModule.hasResults || false,
    // Eligibility criteria
    EligibilityCriteria: stripMarkTags(
      eligibilityModule.eligibilityCriteria || ''
    ),
    HealthyVolunteers: eligibilityModule.healthyVolunteers || 'No',
    Gender: eligibilityModule.sex || 'All',
    MinimumAge: eligibilityModule.minimumAge || '',
    MaximumAge: eligibilityModule.maximumAge || '',
    StdAge: eligibilityModule.stdAges || [],
  };
};

/**
 * Fetch clinical trials data from clinicaltrials.gov API
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const fetchClinicalTrials = async (req, res) => {
  try {
    const { url, transform } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
      });
    }

    // Make the request to the clinicaltrials.gov API using native fetch
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `API Error: ${response.statusText}`,
      });
    }

    // Parse data from clinicaltrials.gov
    const data = await response.json();

    // If transform=true, transform the data to match frontend expectations
    if (transform === 'true' && data.hits && data.hits.length > 0) {
      // Filter trials to only include those recruiting, active, or will be recruiting soon
      const filteredHits = data.hits.filter((hit) => {
        const study = hit.study || {};
        const protocolSection = study.protocolSection || {};
        const statusModule = protocolSection.statusModule || {};
        const status = statusModule.overallStatus || '';

        return [
          'RECRUITING',
          'ACTIVE_NOT_RECRUITING',
          'NOT_YET_RECRUITING',
        ].includes(status);
      });

      const transformedTrials = filteredHits.map(cleanTrialData);

      return res.status(200).json({
        success: true,
        total: filteredHits.length,
        studies: transformedTrials,
      });
    }

    // Return the raw data if no transform is requested, but still filter by status
    if (data.hits && data.hits.length > 0) {
      // Filter trials to only include those recruiting, active, or will be recruiting soon
      data.hits = data.hits.filter((hit) => {
        const study = hit.study || {};
        const protocolSection = study.protocolSection || {};
        const statusModule = protocolSection.statusModule || {};
        const status = statusModule.overallStatus || '';

        return [
          'RECRUITING',
          'ACTIVE_NOT_RECRUITING',
          'NOT_YET_RECRUITING',
        ].includes(status);
      });

      data.total = data.hits.length;
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching clinical trials:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch clinical trials',
      error: error.message,
    });
  }
};

/**
 * Search clinical trials with more specific parameters
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const searchClinicalTrials = async (req, res) => {
  try {
    const {
      term,
      recr = '', // Recruitment status
      cond = '', // Condition
      intr = '', // Intervention
      cntry = '', // Country
      phase = '', // Study phase
      rslt = '', // Has results
      type = '', // Study type
      age = '', // Age
      gndr = '', // Gender
      spns = '', // Sponsor
      lead = '', // Lead sponsor
      status = 'all', // Overall status
      count = 100, // Number of results
    } = req.query;

    if (!term) {
      return res.status(400).json({
        success: false,
        message: 'Search term is required',
      });
    }

    // Construct the clinicaltrials.gov API URL with parameters
    let apiUrl = `https://clinicaltrials.gov/api/int/studies?term=${encodeURIComponent(term)}&agg.synonyms=true&from=0&limit=${count}`;

    // Add all the optional filters
    if (recr) apiUrl += `&recr=${encodeURIComponent(recr)}`;
    if (cond) apiUrl += `&cond=${encodeURIComponent(cond)}`;
    if (intr) apiUrl += `&intr=${encodeURIComponent(intr)}`;
    if (cntry) apiUrl += `&cntry=${encodeURIComponent(cntry)}`;
    if (phase) apiUrl += `&phase=${encodeURIComponent(phase)}`;
    if (rslt) apiUrl += `&rslt=${encodeURIComponent(rslt)}`;
    if (type) apiUrl += `&type=${encodeURIComponent(type)}`;
    if (age) apiUrl += `&age=${encodeURIComponent(age)}`;
    if (gndr) apiUrl += `&gndr=${encodeURIComponent(gndr)}`;
    if (spns) apiUrl += `&spns=${encodeURIComponent(spns)}`;
    if (lead) apiUrl += `&lead=${encodeURIComponent(lead)}`;

    // Add important fields to return
    apiUrl +=
      '&fields=OverallStatus,LastKnownStatus,StatusVerifiedDate,HasResults,BriefTitle,Condition,InterventionType,InterventionName,LocationFacility,LocationCity,LocationState,LocationCountry,LocationStatus,LocationZip,LocationGeoPoint,LocationContactName,LocationContactRole,LocationContactPhone,LocationContactPhoneExt,LocationContactEMail,CentralContactName,CentralContactRole,CentralContactPhone,CentralContactPhoneExt,CentralContactEMail,Gender,MinimumAge,MaximumAge,StdAge,NCTId,StudyType,LeadSponsorName,Acronym,EnrollmentCount,StartDate,PrimaryCompletionDate,CompletionDate,StudyFirstPostDate,ResultsFirstPostDate,LastUpdatePostDate,OrgStudyId,SecondaryId,Phase,LargeDocLabel,LargeDocFilename,PrimaryOutcomeMeasure,SecondaryOutcomeMeasure,DesignAllocation,DesignInterventionModel,DesignMasking,DesignWhoMasked,DesignPrimaryPurpose,DesignObservationalModel,DesignTimePerspective,LeadSponsorClass,CollaboratorClass,BriefSummary,DetailedDescription,EligibilityCriteria,HealthyVolunteers,Sex,Gender,MinimumAge,MaximumAge,StdAge&columns=conditions,interventions,collaborators&highlight=true&sort=@relevance';

    // Make the request to the clinicaltrials.gov API using native fetch
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `API Error: ${response.statusText}`,
      });
    }

    const data = await response.json();

    // Process and transform the data to match frontend expectations
    if (data.hits && data.hits.length > 0) {
      // Filter hits to only include trials that are recruiting, active, or will be recruiting soon
      const filteredHits = data.hits.filter((hit) => {
        const study = hit.study || {};
        const protocolSection = study.protocolSection || {};
        const statusModule = protocolSection.statusModule || {};
        const status = statusModule.overallStatus || '';

        return [
          'RECRUITING',
          'ACTIVE_NOT_RECRUITING',
          'NOT_YET_RECRUITING',
        ].includes(status);
      });

      const transformedTrials = filteredHits.map(cleanTrialData);

      return res.status(200).json({
        success: true,
        total: filteredHits.length,
        studies: transformedTrials,
      });
    } else {
      return res.status(200).json({
        success: true,
        total: 0,
        studies: [],
      });
    }
  } catch (error) {
    console.error('Error searching clinical trials:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Failed to search clinical trials',
      error: error.message,
    });
  }
};

/**
 * Endpoint to get specific trials by NCT IDs for chat integration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getTrialsByIds = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid trial IDs array is required',
      });
    }

    // Process each ID to get trial data
    const trialPromises = ids.map(async (nctId) => {
      try {
        // Construct URL for each trial
        const apiUrl = `https://clinicaltrials.gov/api/int/studies/${nctId}`;

        const response = await fetch(apiUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          console.error(
            `Error fetching trial ${nctId}: ${response.statusText}`
          );
          return null;
        }

        const data = await response.json();

        if (!data || !data.study) {
          return null;
        }

        // Extract locations with more details
        const locations = (
          data.study?.protocolSection?.contactsLocationsModule?.locations || []
        ).map((loc) => ({
          country: loc.country || '',
          state: loc.state || '',
          city: loc.city || '',
          facility: stripMarkTags(loc.facility || ''),
          status: loc.status || '',
          zip: loc.zip || '',
          contactName: loc.contactName || '',
          contactEmail: loc.contactEmail || '',
          contactPhone: loc.contactPhone || '',
        }));

        // Clean the trial data
        return {
          nctId,
          title: stripMarkTags(
            data.study?.protocolSection?.identificationModule?.briefTitle || ''
          ),
          status:
            data.study?.protocolSection?.statusModule?.overallStatus || '',
          phase:
            data.study?.protocolSection?.designModule?.phases?.join(', ') ||
            'N/A',
          condition: (
            data.study?.protocolSection?.conditionsModule?.conditions || []
          ).map((cond) => stripMarkTags(cond)),
          intervention: (
            data.study?.protocolSection?.armsInterventionsModule
              ?.interventions || []
          ).map((int) => stripMarkTags(int.name)),
          locations,
          summary: stripMarkTags(
            data.study?.protocolSection?.descriptionModule?.briefSummary || ''
          ),
          startDate:
            data.study?.protocolSection?.statusModule?.startDateStruct?.date ||
            '',
          eligibility: {
            criteria: stripMarkTags(
              data.study?.protocolSection?.eligibilityModule
                ?.eligibilityCriteria || ''
            ),
            healthyVolunteers:
              data.study?.protocolSection?.eligibilityModule
                ?.healthyVolunteers || 'No',
            gender:
              data.study?.protocolSection?.eligibilityModule?.sex || 'All',
            minimumAge:
              data.study?.protocolSection?.eligibilityModule?.minimumAge || '',
            maximumAge:
              data.study?.protocolSection?.eligibilityModule?.maximumAge || '',
            stdAges:
              data.study?.protocolSection?.eligibilityModule?.stdAges || [],
          },
        };
      } catch (error) {
        console.error(`Error processing trial ${nctId}:`, error);
        return null;
      }
    });

    // Wait for all promises to resolve
    const trialsData = await Promise.all(trialPromises);

    // Filter out any null results
    const validTrials = trialsData.filter((trial) => trial !== null);

    // Return formatted trial data
    return res.status(200).json({
      success: true,
      trials: validTrials,
    });
  } catch (error) {
    console.error('Error getting trials by IDs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get trial information',
      error: error.message,
    });
  }
};

/**
 * Search clinical trials using the full_studies endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const searchClinicalTrialsFullStudies = async (req, res) => {
  try {
    const { expr, min_rnk = '1', max_rnk = '100', fmt = 'json' } = req.query;

    if (!expr) {
      return res.status(400).json({
        success: false,
        message: 'Expression parameter is required',
      });
    }

    // Convert the expression to the API v2 format
    // For API v2, we need to use query.term instead of expr
    const queryParams = new URLSearchParams();
    queryParams.append('query.term', expr);
    queryParams.append('pageSize', max_rnk);

    // Calculate pageToken based on min_rnk if needed
    const minRank = parseInt(min_rnk);
    if (minRank > 1) {
      // For pagination, we would need to implement pageToken logic
      // For now, we'll start from the beginning
      queryParams.append('pageSize', max_rnk);
    }

    // Construct the ClinicalTrials.gov API v2 URL
    const apiUrl = `https://clinicaltrials.gov/api/v2/studies?${queryParams.toString()}`;

    // Make the request to the clinicaltrials.gov API using native fetch
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `API Error: ${response.statusText}`,
      });
    }

    const data = await response.json();

    // Transform the API v2 response to match the regular search endpoint format
    if (data.studies && data.studies.length > 0) {
      // Filter trials to only include those recruiting, active, or will be recruiting soon
      const filteredStudies = data.studies.filter((study) => {
        const protocolSection = study.protocolSection || {};
        const statusModule = protocolSection.statusModule || {};
        const status = statusModule.overallStatus || '';

        return [
          'RECRUITING',
          'ACTIVE_NOT_RECRUITING',
          'NOT_YET_RECRUITING',
        ].includes(status);
      });

      // Convert API v2 format to the format expected by cleanTrialData
      const transformedHits = filteredStudies.map((study) => ({
        study: study,
      }));

      // Use the existing cleanTrialData function to format the data
      const transformedTrials = transformedHits.map(cleanTrialData);

      return res.status(200).json({
        success: true,
        total: transformedTrials.length,
        studies: transformedTrials,
      });
    } else {
      return res.status(200).json({
        success: true,
        total: 0,
        studies: [],
      });
    }
  } catch (error) {
    console.error(
      'Error searching clinical trials (full studies):',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to search clinical trials',
      error: error.message,
    });
  }
};
