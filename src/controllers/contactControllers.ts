import { getErrorMessage } from '../utils/errorUtils';
import { Request, Response } from 'express';
import Contact, { IContact } from '../models/contacts';
import User from '../models/users';
import { memoryStorage } from '../services/memoryStorageService';
import { Types } from 'mongoose';
import { createNotification } from '../services/notificationService';
import { sendContactRequestEmail, sendContactAcceptedEmail } from '../services/emailService';
import { decrypt } from '../utils/masterEncryptionUtils';

/**
 * Fonction utilitaire pour obtenir le nom d'affichage d'un utilisateur
 * Respecte le paramètre showPseudo : si activé et pseudo défini, utilise le pseudo
 */
async function getDisplayName(userId: string): Promise<string> {
    const { decrypt } = await import('../utils/masterEncryptionUtils');
    const user = await User.findById(userId).select('name surname pseudo showPseudo');

    if (!user) return 'Un utilisateur';

    // Si showPseudo est activé et pseudo existe, utiliser le pseudo
    if (user.showPseudo && user.pseudo) {
        try {
            return decrypt(user.pseudo);
        } catch (e) {
            // Fallback sur le nom si erreur de déchiffrement du pseudo
        }
    }

    // Sinon, utiliser le nom complet
    try {
        const name = decrypt(user.name);
        const surname = decrypt(user.surname);
        return `${name} ${surname}`;
    } catch (e) {
        return 'Un utilisateur';
    }
}

/**
 * Ajouter un contact via son code utilisateur (@code)
 * POST /contacts
 * Body: { contactCode: "@129876" }
 */
export const addContact = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactCode } = req.body;

        if (!contactCode || !contactCode.startsWith('@')) {
            res.status(400).json({ error: 'Code de contact invalide. Format attendu: @XXXXXX' });
            return;
        }

        // Trouver l'utilisateur cible par son code
        // contactCode est sous la forme '@123456', il faut comparer avec contact_code (number)
        const codeNumber = parseInt(contactCode.replace('@', ''));
        const targetUser = await User.findOne({ contact_code: codeNumber }).select('_id contact_code');

        if (!targetUser) {
            res.status(404).json({ error: 'Utilisateur introuvable avec ce code' });
            return;
        }

        if ((targetUser._id as Types.ObjectId).toString() === userId) {
            res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même' });
            return;
        }

        // Vérifier si le contact existe déjà
        const existingContact = await Contact.findOne({
            userId: new Types.ObjectId(userId),
            contactId: targetUser._id
        });

        if (existingContact) {
            res.status(409).json({
                error: 'Contact déjà existant',
                status: existingContact.status,
                contactId: existingContact._id
            });
            return;
        }

        // Créer le contact avec statut "pending"
        const newContact = new Contact({
            userId: new Types.ObjectId(userId),
            contactId: targetUser._id,
            contactCode: contactCode,
            isBlocked: false,
            status: 'pending'
        });

        await newContact.save();

        // Vérifier si l'autre utilisateur a aussi ajouté ce contact
        const reverseContact = await Contact.findOne({
            userId: targetUser._id,
            contactId: new Types.ObjectId(userId)
        });

        // Si oui, passer les deux contacts en "accepted"
        if (reverseContact) {
            await Contact.updateMany(
                {
                    $or: [
                        { _id: newContact._id },
                        { _id: reverseContact._id }
                    ]
                },
                { status: 'accepted' }
            );

            newContact.status = 'accepted';

            // Créer une notification pour l'autre utilisateur
            const displayName = await getDisplayName(userId);

            await createNotification(
                targetUser._id as Types.ObjectId,
                'contact_accepted',
                'Demande de contact acceptée',
                `${displayName} a accepté votre demande de contact`,
                {
                    contactId: newContact._id as Types.ObjectId,
                    senderId: new Types.ObjectId(userId)
                }
            );

            // Rafraîchir la session de l'autre utilisateur si connecté
            if (memoryStorage.hasSession((targetUser._id as Types.ObjectId).toString())) {
                try {
                    memoryStorage.storeContact((targetUser._id as Types.ObjectId).toString(), reverseContact);
                } catch (error) {
                    console.log(`⚠️ Impossible de rafraîchir la session de ${targetUser._id}`);
                }
            }

            // Envoyer un email de notification d'acceptation (asynchrone)
            const targetUserFull = await User.findById(targetUser._id).select('email name');
            if (targetUserFull?.email) {
                const recipientEmail = decrypt(targetUserFull.email);
                const recipientName = decrypt(targetUserFull.name);
                const senderName = await getDisplayName(userId);

                sendContactAcceptedEmail(recipientEmail, recipientName, senderName)
                    .catch(err => console.error('Erreur envoi email contact accepté:', err));
            }
        } else {
            // Créer une notification pour le destinataire de la demande
            const displayName = await getDisplayName(userId);

            await createNotification(
                targetUser._id as Types.ObjectId,
                'contact_request',
                'Nouvelle demande de contact',
                `${displayName} souhaite vous ajouter en contact`,
                {
                    contactId: newContact._id as Types.ObjectId,
                    senderId: new Types.ObjectId(userId)
                }
            );

            // Envoyer un email de demande de contact (asynchrone)
            const targetUserFull = await User.findById(targetUser._id).select('email name');
            if (targetUserFull?.email) {
                const recipientEmail = decrypt(targetUserFull.email);
                const recipientName = decrypt(targetUserFull.name);
                const requesterName = await getDisplayName(userId);
                const frontendUrl = process.env.FRONTEND_URL || 'https://qvarry.com';
                const acceptLink = `${frontendUrl}/contacts`;

                sendContactRequestEmail(recipientEmail, recipientName, requesterName, acceptLink)
                    .catch(err => console.error('Erreur envoi email demande contact:', err));
            }
        }

        // Stocker dans la session du demandeur
        if (userId && memoryStorage.hasSession(userId)) {
            memoryStorage.storeContact(userId, newContact);
        }

        res.status(201).json({
            success: true,
            contact: {
                _id: newContact._id,
                contactId: newContact.contactId,
                contactCode: newContact.contactCode,
                status: newContact.status,
                isBlocked: newContact.isBlocked,
                createdAt: newContact.createdAt
            }
        });

    } catch (error: unknown) {
        console.error('❌ Erreur lors de l\'ajout du contact:', error);
        res.status(500).json({
            error: 'Erreur lors de l\'ajout du contact',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Lister tous les contacts de l'utilisateur
 * GET /contacts
 * Query: status=pending|accepted (optionnel)
 */
export const listContacts = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { status } = req.query;

        console.log(`[CONTACTS] Récupération des contacts pour userId: ${userId}, status: ${status}`);

        // Sinon, récupérer depuis la DB
        // Correction : inclure les contacts où l'utilisateur est soit userId, soit contactId
        const query: any = {
            $or: [
                { userId: new Types.ObjectId(userId) },
                { contactId: new Types.ObjectId(userId) }
            ]
        };
        if (status) {
            query.status = status;
        }

        const contacts = await Contact.find(query)
            .populate('contactId', 'name surname contact_code pseudo showPseudo')
            .populate('userId', 'name surname contact_code pseudo showPseudo')
            .sort({ createdAt: -1 });

        console.log(`[CONTACTS] ${contacts.length} contacts trouvés`);

        // Formatter la réponse avec contactInfo enrichi et déchiffrement
        const { decrypt } = await import('../utils/masterEncryptionUtils');

        res.status(200).json({
            contacts: contacts.map(c => {
                const contactUser = (c.contactId as any);
                const senderUser = (c.userId as any);

                // Déterminer qui est "l'autre" personne selon si on est userId ou contactId
                const isRecipient = (c.contactId as any)._id?.toString() === userId;
                const otherUser = isRecipient ? senderUser : contactUser;

                // Si l'autre utilisateur existe, déchiffrer ses champs
                let contactInfo = undefined;
                if (otherUser && otherUser._id) {
                    try {
                        console.log(`[CONTACTS] Infos brutes pour ${otherUser._id}:`, {
                            name: otherUser.name ? 'encrypted' : 'undefined',
                            surname: otherUser.surname ? 'encrypted' : 'undefined',
                            hasPseudo: !!otherUser.pseudo,
                            showPseudo: otherUser.showPseudo,
                            pseudoLength: otherUser.pseudo?.length
                        });

                        // Déchiffrer le pseudo seulement s'il existe et n'est pas vide
                        let decryptedPseudo = undefined;
                        if (otherUser.pseudo && otherUser.pseudo.trim() !== '') {
                            try {
                                decryptedPseudo = decrypt(otherUser.pseudo);
                                console.log(`[CONTACTS] Pseudo déchiffré avec succès:`, decryptedPseudo);
                            } catch (pseudoError) {
                                console.warn(`[CONTACTS] Erreur déchiffrement pseudo, sera ignoré:`, pseudoError);
                                decryptedPseudo = undefined;
                            }
                        } else {
                            console.log(`[CONTACTS] Pas de pseudo défini pour ${otherUser._id}`);
                        }

                        // SÉCURITÉ : Si showPseudo est activé et qu'un pseudo existe,
                        // ne PAS envoyer les données personnelles (name, surname)
                        if (otherUser.showPseudo && decryptedPseudo) {
                            contactInfo = {
                                _id: otherUser._id,
                                name: decryptedPseudo, // Utiliser le pseudo comme "nom" pour compatibilité
                                surname: '', // Vide pour sécurité
                                userCode: otherUser.contact_code ? `@${otherUser.contact_code}` : undefined,
                                pseudo: decryptedPseudo,
                                showPseudo: true
                            };
                            console.log(`[CONTACTS] 🔒 Mode pseudo activé - données personnelles masquées pour ${otherUser._id}`);
                        } else {
                            // Mode normal : envoyer nom/prénom (JAMAIS l'email)
                            const decryptedName = otherUser.name ? decrypt(otherUser.name) : 'Inconnu';
                            const decryptedSurname = otherUser.surname ? decrypt(otherUser.surname) : '';

                            contactInfo = {
                                _id: otherUser._id,
                                name: decryptedName,
                                surname: decryptedSurname,
                                userCode: otherUser.contact_code ? `@${otherUser.contact_code}` : undefined,
                                pseudo: decryptedPseudo,
                                showPseudo: otherUser.showPseudo || false
                            };
                        }

                        console.log(`[CONTACTS] ContactInfo final:`, {
                            name: contactInfo.name,
                            surname: contactInfo.surname,
                            pseudo: contactInfo.pseudo,
                            showPseudo: contactInfo.showPseudo
                        });
                    } catch (decryptError) {
                        console.error(`[CONTACTS] Erreur déchiffrement pour contact ${otherUser._id}:`, decryptError);
                        contactInfo = {
                            _id: otherUser._id,
                            name: "Erreur",
                            surname: "Déchiffrement",
                            userCode: otherUser.contact_code ? `@${otherUser.contact_code}` : undefined,
                            pseudo: undefined,
                            showPseudo: false
                        };
                    }
                }

                return {
                    _id: c._id,
                    userId: senderUser?._id || c.userId,
                    contactId: contactUser?._id || c.contactId,
                    contactCode: c.contactCode,
                    status: c.status,
                    isBlocked: c.isBlocked,
                    createdAt: c.createdAt,
                    isRecipient, // Indique si l'utilisateur courant est le destinataire (doit valider)
                    contactInfo
                };
            })
        });

    } catch (error: unknown) {
        console.error('❌ Erreur lors de la récupération des contacts:', error);
        if (error instanceof Error && error.stack) {
            console.error('Stack:', error.stack);
        }
        res.status(500).json({
            error: 'Erreur lors de la récupération des contacts',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Bloquer ou débloquer un contact
 * PATCH /contacts/:contactId/block
 * Body: { isBlocked: true|false }
 */
export const blockContact = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactId } = req.params;
        const { isBlocked } = req.body;

        if (typeof isBlocked !== 'boolean') {
            res.status(400).json({ error: 'Le champ isBlocked doit être un booléen' });
            return;
        }

        const contact = await Contact.findOne({
            userId: new Types.ObjectId(userId),
            contactId: new Types.ObjectId(contactId)
        });

        if (!contact) {
            res.status(404).json({ error: 'Contact introuvable' });
            return;
        }

        contact.isBlocked = isBlocked;
        await contact.save();

        // Mise à jour du cache
        if (userId && memoryStorage.hasSession(userId)) {
            memoryStorage.storeContact(userId, contact);
        }

        res.status(200).json({
            success: true,
            contact: {
                _id: contact._id,
                isBlocked: contact.isBlocked
            }
        });

    } catch (error: unknown) {
        console.error('❌ Erreur lors du blocage/déblocage du contact:', error);
        res.status(500).json({
            error: 'Erreur lors du blocage/déblocage du contact',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Supprimer un contact
 * DELETE /contacts/:contactId
 */
export const deleteContact = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactId } = req.params;

        const contact = await Contact.findOneAndDelete({
            userId: new Types.ObjectId(userId),
            contactId: new Types.ObjectId(contactId)
        });

        if (!contact) {
            res.status(404).json({ error: 'Contact introuvable' });
            return;
        }

        // Supprimer du cache
        if (userId && memoryStorage.hasSession(userId)) {
            memoryStorage.deleteContact(userId, contactId);
        }

        res.status(200).json({ success: true });

    } catch (error: unknown) {
        console.error('❌ Erreur lors de la suppression du contact:', error);
        res.status(500).json({
            error: 'Erreur lors de la suppression du contact',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Obtenir les détails d'un contact spécifique
 * GET /contacts/:contactId
 */
export const getContactDetails = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactId } = req.params;

        const contact = await Contact.findOne({
            userId: new Types.ObjectId(userId),
            contactId: new Types.ObjectId(contactId)
        }).populate('contactId', 'name surname contact_code pseudo showPseudo');

        if (!contact) {
            res.status(404).json({ error: 'Contact introuvable' });
            return;
        }

        const { decrypt } = await import('../utils/masterEncryptionUtils');
        const contactUser = (contact.contactId as any);

        let contactInfo = undefined;
        if (contactUser && contactUser._id) {
            try {
                // Déchiffrer le pseudo s'il existe
                let decryptedPseudo = undefined;
                if (contactUser.pseudo && contactUser.pseudo.trim() !== '') {
                    try {
                        decryptedPseudo = decrypt(contactUser.pseudo);
                    } catch (e) {
                        decryptedPseudo = undefined;
                    }
                }

                // SÉCURITÉ : Si showPseudo est activé et qu'un pseudo existe,
                // ne PAS envoyer les données personnelles
                if (contactUser.showPseudo && decryptedPseudo) {
                    contactInfo = {
                        _id: contactUser._id,
                        name: decryptedPseudo,
                        surname: '',
                        userCode: contactUser.contact_code ? `@${contactUser.contact_code}` : undefined,
                        pseudo: decryptedPseudo,
                        showPseudo: true
                    };
                } else {
                    // Mode normal : envoyer nom/prénom (JAMAIS l'email)
                    contactInfo = {
                        _id: contactUser._id,
                        name: decrypt(contactUser.name),
                        surname: decrypt(contactUser.surname),
                        userCode: contactUser.contact_code ? `@${contactUser.contact_code}` : undefined,
                        pseudo: decryptedPseudo,
                        showPseudo: contactUser.showPseudo || false
                    };
                }
            } catch (decryptError) {
                console.error(`[CONTACTS] Erreur déchiffrement:`, decryptError);
            }
        }

        res.status(200).json({
            contact: {
                _id: contact._id,
                userId: contact.userId,
                contactId: contactUser?._id || contact.contactId,
                contactCode: contact.contactCode,
                status: contact.status,
                isBlocked: contact.isBlocked,
                createdAt: contact.createdAt,
                contactInfo
            }
        });


    } catch (error: unknown) {
        console.error('❌ Erreur lors de la récupération du contact:', error);
        res.status(500).json({
            error: 'Erreur lors de la récupération du contact',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Accepter une demande de contact
 * POST /contacts/:contactId/accept
 */
export const acceptContact = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactId } = req.params;

        // Trouver le contact où l'utilisateur courant est le destinataire (contactId)
        const contact = await Contact.findOne({
            _id: new Types.ObjectId(contactId),
            contactId: new Types.ObjectId(userId),
            status: 'pending'
        });

        if (!contact) {
            res.status(404).json({ error: 'Demande de contact introuvable ou déjà traitée' });
            return;
        }

        // Passer le contact en "accepted"
        contact.status = 'accepted';
        await contact.save();

        // Mettre à jour le cache
        if (userId && memoryStorage.hasSession(userId)) {
            memoryStorage.storeContact(userId, contact);
        }

        // Créer une notification pour l'émetteur de la demande
        const displayName = await getDisplayName(userId);

        await createNotification(
            contact.userId as Types.ObjectId,
            'contact_accepted',
            'Demande de contact acceptée',
            `${displayName} a accepté votre demande de contact`,
            {
                contactId: contact._id as Types.ObjectId,
                senderId: new Types.ObjectId(userId)
            }
        );

        // Envoyer un email de notification d'acceptation (asynchrone)
        const senderUser = await User.findById(contact.userId).select('email name');
        if (senderUser?.email) {
            const recipientEmail = decrypt(senderUser.email);
            const recipientName = decrypt(senderUser.name);
            const accepterName = await getDisplayName(userId);

            sendContactAcceptedEmail(recipientEmail, recipientName, accepterName)
                .catch(err => console.error('Erreur envoi email contact accepté:', err));
        }

        res.status(200).json({
            success: true,
            contact: {
                _id: contact._id,
                status: contact.status
            }
        });

    } catch (error: unknown) {
        console.error('❌ Erreur lors de l\'acceptation du contact:', error);
        res.status(500).json({
            error: 'Erreur lors de l\'acceptation du contact',
            details: getErrorMessage(error)
        });
    }
};

/**
 * Refuser une demande de contact
 * POST /contacts/:contactId/refuse
 */
export const refuseContact = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Utilisateur non authentifié' });
            return;
        }
        const { contactId } = req.params;

        // Trouver et supprimer le contact où l'utilisateur courant est le destinataire (contactId)
        const contact = await Contact.findOneAndDelete({
            _id: new Types.ObjectId(contactId),
            contactId: new Types.ObjectId(userId),
            status: 'pending'
        });

        if (!contact) {
            res.status(404).json({ error: 'Demande de contact introuvable ou déjà traitée' });
            return;
        }

        // Supprimer du cache si présent
        if (userId && memoryStorage.hasSession(userId)) {
            memoryStorage.deleteContact(userId, contactId);
        }

        res.status(200).json({
            success: true,
            message: 'Demande de contact refusée'
        });

    } catch (error: unknown) {
        console.error('❌ Erreur lors du refus du contact:', error);
        res.status(500).json({
            error: 'Erreur lors du refus du contact',
            details: getErrorMessage(error)
        });
    }
};
