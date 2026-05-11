import { SURVEY_MAPPINGS } from '../config/surveyMappings.js';
import {
  getSurveyResponsesWithAnswersService,
  getSurveyByIdService,
  createSurveyResponseService,
  updateSurveyResponseService,
  getAllSurveysServiceForUser,
  updateSurveyService,
  hasUserRespondedToSurvey,
  markSurveyAsResponded,
  getUserSurveyResponseIds,
  getSurveysByIds,
  getAllSurveysService,
  createSurveyService,
  deleteSurveyService,
} from '../services/surveyService.js';
import { snakeToCamelCase } from '../utils/general.js';
import { uploadToS3, constructS3Url } from '../utils/s3Utils.js';

export const surveyController = {
  getResponsesBySurveyId: async (req, res) => {
    try {
      const surveyResponses = await getSurveyResponsesWithAnswersService(
        req.params.id
      );
      if (!surveyResponses) {
        return res.status(404).json({ error: 'survey not found' });
      }

      // Flatten the responses
      const flattenedResponses = surveyResponses.map((response) => {
        const flatResponse = {
          'Response ID': response.response_id,
          'Response Date': response.response_date,
        };

        // Add each answer as a direct property
        response.answers.forEach((answer) => {
          // Convert snake_case to Title Case
          const key = answer.reportHeader
            .toLowerCase()
            .split(/[_\s]+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          if (answer.questionType === 'file_upload') {
            flatResponse[key] = constructS3Url(answer.answer);
          } else {
            flatResponse[key] = answer.answer;
          }
        });

        return flatResponse;
      });

      res.status(200).json(snakeToCamelCase(flattenedResponses));
    } catch (error) {
      console.error('Error fetching survey:', error);
      res.status(500).json({ error: 'Failed to fetch survey' });
    }
  },

  getAllSurveysForUser: async (req, res) => {
    try {
      // First get all survey IDs the user has responded to
      const surveyIds = await getUserSurveyResponseIds(req.auth.dbUserId);

      // If no responses found, return early
      if (!surveyIds.length) {
        return res.status(200).json([]);
      }

      // Get the full survey details for these IDs
      const surveys = await getSurveysByIds(surveyIds);

      // Add image URLs and transform to camelCase
      const surveysWithUrls = surveys.map((survey) => ({
        ...survey,
        image_url: survey.organization_image_key
          ? constructS3Url(survey.organization_image_key)
          : null,
        has_responded: true, // We know they've responded since these are from responses
      }));

      const camelCaseSurveys = snakeToCamelCase(surveysWithUrls);
      res.status(200).json(camelCaseSurveys);
    } catch (error) {
      console.error('Error fetching user surveys:', error);
      res.status(500).json({ error: 'Failed to fetch surveys' });
    }
  },

  createSurveyResponse: async (req, res) => {
    try {
      const surveyResult = await getSurveyByIdService(req.params.id);

      if (!surveyResult || surveyResult.length === 0) {
        return res.status(404).json({ error: 'survey not found' });
      }

      const survey = surveyResult[0];

      if (!survey.id) {
        return res
          .status(500)
          .json({ error: 'Invalid survey data - missing ID' });
      }

      // Check if user has responded to this survey
      const hasResponded = await hasUserRespondedToSurvey(
        survey.id,
        req.auth.dbUserId
      );

      if (hasResponded) {
        return res.status(409).json({
          error: 'You have already submitted a response to this survey',
        });
      }

      // let answers =  -- leaving for full implementation
      //   typeof req.body.formData.answers === "string"
      //     ? JSON.parse(req.body.formData.answers)
      //     : req.body.formData.answers;

      // Map the question IDs using SURVEY_MAPPINGS
      // const mappedAnswers = answers.map((answer) => {
      //   const surveyType = Object.keys(SURVEY_MAPPINGS).find(
      //     (key) => SURVEY_MAPPINGS[key].id === survey.id
      //   );

      //   if (surveyType) {
      //     const mappedQuestionId =
      //       SURVEY_MAPPINGS[surveyType].questions[answer.questionId];
      //     return {
      //       ...answer,
      //       question: answer.questionId,
      //       questionId: mappedQuestionId || answer.questionId,
      //     };
      //   }
      //   return answer;
      // });

      // const surveyData = {
      //   userId: req.dbUserId,
      //   surveyId: survey.id,
      //   answers: mappedAnswers,
      // };

      // console.log("Debug - surveyData:", surveyData);

      const surveyResponse = await markSurveyAsResponded(
        survey.id,
        req.auth.dbUserId
      );

      res.status(201).json(surveyResponse);
    } catch (error) {
      console.error('Error creating survey response:', error);
      res.status(500).json({
        error: 'Failed to create survey response',
        details: error.message,
      });
    }
  },

  updateSurveyResponse: async (req, res) => {
    try {
      const responseId = req.body.formData.responseId;
      if (!responseId) {
        return res.status(400).json({ error: 'Response ID is required' });
      }

      const formData = req.body.formData;

      // Get the survey type from the survey ID
      const surveyType = Object.keys(SURVEY_MAPPINGS).find(
        (key) => SURVEY_MAPPINGS[key].id === req.params.id
      );

      if (!surveyType) {
        return res.status(404).json({ error: 'Survey mapping not found' });
      }

      const surveyConfig = SURVEY_MAPPINGS[surveyType];
      let answers = [];

      // Process all fields from formData
      Object.entries(formData).forEach(([key, value]) => {
        const questionId = surveyConfig.questions[key];

        if (questionId) {
          if (Array.isArray(value)) {
            // Handle nested array fields
            answers.push({
              questionId,
              answer: JSON.stringify(value),
              questionType: 'nested_array',
            });
          } else {
            // Handle regular fields
            answers.push({
              questionId,
              answer: value?.toString() ?? '',
              questionType: surveyConfig.questionTypes?.[key] || 'text',
            });
          }
        }
      });

      const updateData = {
        userId: req.auth.dbUserId,
        responseId,
        answers,
      };

      const updatedResponse = await updateSurveyResponseService(updateData);
      res.status(200).json(updatedResponse);
    } catch (error) {
      console.error('Error updating survey response:', error);
      res.status(500).json({
        error: 'Failed to update survey response',
        details: error.message,
      });
    }
  },

  getSurveyById: async (req, res) => {
    try {
      const tenantIds = req.tenantIds;
      const survey = await getSurveyByIdService(req.params.id, tenantIds);

      if (!survey) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      res.status(200).json(snakeToCamelCase(survey));
    } catch (error) {
      console.error('Error fetching survey:', error);
      res.status(500).json({ error: 'Failed to fetch survey' });
    }
  },

  updateSurvey: async (req, res) => {
    try {
      let imageKey = null;
      const tenantIds = req.tenantIds;

      // Handle file upload if present
      if (req.file) {
        imageKey = await uploadToS3(req.file);
      }

      // Get current survey to check organizations
      const currentSurvey = await getSurveyByIdService(
        req.params.id,
        tenantIds
      );
      if (!currentSurvey) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      // Safely handle current and new organization IDs, allowing for undefined/null values
      const currentOrgIds =
        currentSurvey.organizations?.map((org) => org.id) || [];
      const newOrgIds = (req.body.organizations || [])
        .map((org) => (typeof org === 'string' ? org : org.id))
        .filter(Boolean);

      // Calculate organizations to remove and add
      const orgsToRemove = currentOrgIds.filter(
        (id) => id && !newOrgIds.includes(id)
      );
      const orgsToAdd = newOrgIds.filter(
        (id) => id && !currentOrgIds.includes(id)
      );

      // Prepare survey data for update
      const surveyData = {
        ...req.body,
        ...(imageKey && { imageKey }),
        organizationsToRemove: orgsToRemove,
        orgsToAdd: orgsToAdd,
      };

      const survey = await updateSurveyService(req.params.id, surveyData);

      // Add image URL to response
      const responseData = {
        ...survey,
        imageUrl: survey.imageKey ? constructS3Url(survey.imageKey) : null,
      };

      res.status(200).json(snakeToCamelCase(responseData));
    } catch (error) {
      console.error('Error updating survey:', error);
      res.status(500).json({ error: 'Failed to update survey' });
    }
  },

  getAllSurveys: async (req, res) => {
    const tenantIds = req.tenantIds;
    try {
      const surveys = await getAllSurveysService(req.auth.dbUserId, tenantIds);
      res.status(200).json(snakeToCamelCase(surveys));
    } catch (error) {
      console.error('Error fetching surveys:', error);
      res.status(500).json({ error: 'Failed to fetch surveys' });
    }
  },

  async createSurvey(req, res) {
    try {
      // Extract organizations from the request body
      const { organizations, ...surveyData } = req.body;

      // Add the authenticated user's ID to the survey data
      const surveyWithUser = {
        ...surveyData,
        createdByUserId: req.auth.dbUserId,
        lastUpdatedByUserId: req.auth.dbUserId,
      };

      // Create the survey and associate organizations in a single transaction
      const survey = await createSurveyService({
        ...surveyWithUser,
        organizations: organizations?.map((org) => org.id) || [], // Pass only organization IDs
      });

      res.status(201).json(survey);
    } catch (error) {
      console.error('Error creating survey:', error);
      res.status(500).json({ error: 'Failed to create survey' });
    }
  },

  async deleteSurvey(req, res) {
    try {
      // First, get the survey to check ownership
      const survey = await getSurveyByIdService(req.params.id);
      if (!survey) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      // Check if user is the creator of the survey
      if (survey.created_by_user_id !== req.auth.dbUserId) {
        return res.status(403).json({
          error:
            'Forbidden: You must be an admin or the survey creator to delete this survey',
        });
      }

      const deletedSurvey = await deleteSurveyService(req.params.id);
      res.status(200).json(deletedSurvey);
    } catch (error) {
      console.error('Error deleting survey:', error);
      res.status(500).json({ error: 'Failed to delete survey' });
    }
  },
};
