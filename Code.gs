function checkRecentAdminActivities() {
  var webhookUrl = "YOUR_WEBHOOK_URL"; // Remplacez par votre URL de webhook Discord
  var sharedDriveId = "YOUR_DRIVE_S3_URL"; // Remplacez par l'ID de votre Drive partagé

  // Récupérer le dernier horodatage traité
  var properties = PropertiesService.getScriptProperties();
  var lastProcessedTime = properties.getProperty('LAST_PROCESSED_TIME');

  // Si c'est la première exécution, initialiser l'horodatage
  if (!lastProcessedTime) {
    lastProcessedTime = new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  var now = new Date();
  var endTime = now.toISOString();

  // Construire l'URL de la requête pour l'API Admin Reports
  var url = `https://www.googleapis.com/admin/reports/v1/activity/users/all/applications/admin?startTime=${lastProcessedTime}&endTime=${endTime}`;

  var options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var auditEvents = JSON.parse(response.getContentText());

  var actions = [];
  var mostRecentEventTime = lastProcessedTime;

  if (auditEvents && auditEvents.items) {
    Logger.log(`Nombre d'événements récupérés : ${auditEvents.items.length}`);
    auditEvents.items.forEach(function(event) {
      var eventTime = event.id.time; // Horodatage de l'événement
      var eventType = event.events[0].type;
      var eventName = event.events[0].name;
      var actorEmail = event.actor.email;
      var actorName = getUserName(actorEmail); // Obtenir le nom complet de l'utilisateur
      var target = event.events[0].parameters && event.events[0].parameters.length > 0 ? event.events[0].parameters[0].value : "inconnu";

      // Logs pour vérifier les types et noms d'événements capturés
      Logger.log(`Événement capturé : ${JSON.stringify(event)}`);

      // Mettre à jour l'horodatage le plus récent si cet événement est plus récent
      if (eventTime > mostRecentEventTime) {
        mostRecentEventTime = eventTime;
      }

      // Surveillance des événements spécifiques
      if (eventType === "USER_SETTINGS" && eventName === "SUSPEND_USER") {
        actions.push(`${actorName} a suspendu l'utilisateur ${target}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "UNSUSPEND_USER") {
        actions.push(`${actorName} a réactivé l'utilisateur ${target}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "ADD_NICKNAME") {
        var alias = event.events[0].parameters.find(param => param.name === "USER_NICKNAME").value;
        actions.push(`${actorName} a ajouté l'alias ${alias} à l'utilisateur ${target}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "REMOVE_NICKNAME") {
        var alias = event.events[0].parameters.find(param => param.name === "USER_NICKNAME").value;
        actions.push(`${actorName} a supprimé l'alias ${alias} de l'utilisateur ${target}.`);
      } else if (eventType === "GROUP_SETTINGS" && eventName === "ADD_GROUP_MEMBER") {
        var groupName = event.events[0].parameters.find(param => param.name === "GROUP_EMAIL").value;
        actions.push(`${actorName} a ajouté l'utilisateur ${target} au groupe ${groupName}.`);
      } else if (eventType === "GROUP_SETTINGS" && eventName === "REMOVE_GROUP_MEMBER") {
        var groupName = event.events[0].parameters.find(param => param.name === "GROUP_EMAIL").value;
        actions.push(`${actorName} a retiré l'utilisateur ${target} du groupe ${groupName}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "CREATE_USER") {
        actions.push(`${actorName} a crée l'utilisateur ${target}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "DELETE_USER") {
        actions.push(`${actorName} a supprimé l'utilisateur ${target}.`);
      } else if (eventType === "USER_SETTINGS" && eventName === "CHANGE_PASSWORD") {
        actions.push(`${actorName} a modifié le mot de passe de l'utilisateur ${target}.`);
      }
    });
  }

  if (actions.length > 0) {
    // Créer le contenu du fichier log
    var logContent = "Activités administratives récentes :\n" + actions.join("\n");

    // Accéder au dossier racine du Drive partagé
    var folder = DriveApp.getFolderById(sharedDriveId);

    // Créer le fichier texte dans le Drive partagé
    var fileName = "Google_Workspace_Report_" + Utilities.formatDate(new Date(), "Europe/Paris", "yyyyMMdd_HHmmss") + ".txt";
    var file = folder.createFile(fileName, logContent, MimeType.PLAIN_TEXT);

    // Envoyer le fichier à Discord en pièce jointe
    var payload = {
      content: "Voici le rapport d'activités administratives récentes.",
      username: "Google Workspace Notifier"
    };

    var boundary = "boundary-" + new Date().getTime();
    var mimeContent = Utilities.newBlob("--" + boundary + "\r\n" +
      "Content-Disposition: form-data; name=\"payload_json\"\r\n\r\n" +
      JSON.stringify(payload) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n" +
      "Content-Type: text/plain\r\n\r\n" +
      file.getBlob().getDataAsString() + "\r\n" +
      "--" + boundary + "--").getBytes();

    var finalOptions = {
      method: "post",
      contentType: "multipart/form-data; boundary=" + boundary,
      payload: mimeContent,
      muteHttpExceptions: true
    };

    UrlFetchApp.fetch(webhookUrl, finalOptions);
  } else {
    // Si aucune action n'a été détectée, envoyer un message différent
    var nowFrance = new Date();
    var formattedTime = Utilities.formatDate(nowFrance, "Europe/Paris", "d/MM/yyyy 'à' HH:mm:ss '(local France)'");
    var payload = {
      content: `Aucune action effectuée le ${formattedTime}.`,
      username: "Google Workspace Notifier"
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload)
    };

    UrlFetchApp.fetch(webhookUrl, options);
  }

  // Ajouter un léger décalage pour éviter de rater les événements proches de l'horodatage
  var newLastProcessedTime = new Date(Date.parse(mostRecentEventTime) + 1000).toISOString();
  properties.setProperty('LAST_PROCESSED_TIME', newLastProcessedTime);
}

function getUserName(email) {
  try {
    var user = AdminDirectory.Users.get(email);
    var givenName = user.name.givenName;
    var familyName = user.name.familyName;
    var initialFamilyName = familyName ? familyName.charAt(0).toUpperCase() : '';
    return `${givenName} ${initialFamilyName}.`; // Format: "Lucas V."
  } catch (e) {
    Logger.log(`Erreur lors de la récupération du nom pour l'email ${email}: ${e.message}`);
    return email; // Retourner l'email si l'utilisateur n'est pas trouvé
  }
}
